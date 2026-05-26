import type { RdapDomainResult } from "./types.js";

interface RdapEvent {
  eventAction: string;
  eventDate:   string;
}

interface RdapEntity {
  roles:       string[];
  vcardArray?: unknown[];
}

interface RdapResponse {
  events?:   RdapEvent[];
  entities?: RdapEntity[];
  status?:   string[];
}

// IANA bootstrap response shape
interface IanaBootstrap {
  services: [string[], string[]][];
}

const PRIVACY_PATTERNS = [
  /domains by proxy/i, /whoisguard/i, /privacy protect/i,
  /contactprivacy/i, /withheld for privacy/i, /redacted for privacy/i,
  /identity protection/i, /data protected/i, /private registration/i,
];

// ── IANA bootstrap ────────────────────────────────────────────────────────
// https://data.iana.org/rdap/dns.json is the canonical, IANA-maintained
// mapping of every TLD to its authoritative RDAP server. Fetched once at
// startup and cached for 24 hours. Falls back to rdap.org on any failure.

const IANA_BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";
const RDAP_PROXY         = "https://rdap.org/domain/";
const BOOTSTRAP_TTL_MS   = 24 * 60 * 60 * 1000;

// Seed with known-good Verisign endpoints so .com/.net work immediately
// even before bootstrap finishes loading.
let tldMap: Map<string, string> = new Map([
  ["com", "https://rdap.verisign.com/com/v1/domain/"],
  ["net", "https://rdap.verisign.com/net/v1/domain/"],
]);
let bootstrapLoadedAt = 0;

async function loadBootstrap(): Promise<void> {
  if (Date.now() - bootstrapLoadedAt < BOOTSTRAP_TTL_MS) return;
  try {
    const res  = await fetch(IANA_BOOTSTRAP_URL, { signal: AbortSignal.timeout(6_000) });
    if (!res.ok) throw new Error(`Bootstrap HTTP ${res.status}`);
    const data = await res.json() as IanaBootstrap;
    const next = new Map<string, string>();
    for (const [tlds, urls] of data.services) {
      // IANA lists the base URL without trailing /domain/ — append it
      const base = urls[0]?.replace(/\/$/, "") ?? "";
      if (!base) continue;
      const endpoint = base.endsWith("/domain") ? base + "/" : base + "/domain/";
      for (const tld of tlds) next.set(tld.toLowerCase(), endpoint);
    }
    if (next.size > 0) {
      tldMap = next;
      bootstrapLoadedAt = Date.now();
      console.log(`[rdap] bootstrap loaded — ${next.size} TLDs mapped`);
    }
  } catch (err) {
    console.warn(`[rdap] bootstrap failed, using fallback:`, err instanceof Error ? err.message : err);
  }
}

// Kick off bootstrap on module load (non-blocking)
loadBootstrap().catch(() => {});

function rdapEndpoint(domain: string): string {
  const tld = domain.split(".").pop()?.toLowerCase() ?? "";
  return (tldMap.get(tld) ?? RDAP_PROXY) + domain;
}

// ── Parsers ───────────────────────────────────────────────────────────────

function getEvent(events: RdapEvent[], action: string): string | null {
  return events.find(e => e.eventAction.toLowerCase() === action)?.eventDate ?? null;
}

function getRegistrar(entities: RdapEntity[]): string | null {
  const registrar = entities.find(e => e.roles.includes("registrar"));
  if (!registrar?.vcardArray) return null;
  const vcard = registrar.vcardArray[1] as unknown[][];
  if (!Array.isArray(vcard)) return null;
  for (const entry of vcard) {
    if (Array.isArray(entry) && entry[0] === "fn") return String(entry[3] ?? "");
  }
  return null;
}

function isPrivate(entities: RdapEntity[]): boolean {
  for (const entity of entities) {
    const raw = JSON.stringify(entity.vcardArray ?? "");
    if (PRIVACY_PATTERNS.some(p => p.test(raw))) return true;
  }
  return false;
}

// ── Single fetch ──────────────────────────────────────────────────────────

async function fetchRdap(url: string): Promise<RdapDomainResult> {
  try {
    const res = await fetch(url, {
      signal:  AbortSignal.timeout(8_000),
      headers: { Accept: "application/rdap+json" },
    });

    if (res.status === 404) {
      return { registered: false, registrar: null, registered_at: null, expires_at: null, privacy_protected: false, error: null };
    }
    if (res.status === 429) {
      throw new Error(`RDAP rate limit (429) from ${new URL(url).hostname}`);
    }
    if (!res.ok) {
      throw new Error(`RDAP HTTP ${res.status} from ${new URL(url).hostname}`);
    }

    const data     = await res.json() as RdapResponse;
    const events   = data.events   ?? [];
    const entities = data.entities ?? [];

    return {
      registered:        true,
      registrar:         getRegistrar(entities),
      registered_at:     getEvent(events, "registration"),
      expires_at:        getEvent(events, "expiration"),
      privacy_protected: isPrivate(entities),
      error:             null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("404") && !msg.includes("rate limit")) {
      return { registered: false, registrar: null, registered_at: null, expires_at: null, privacy_protected: false, error: null };
    }
    return { registered: false, registrar: null, registered_at: null, expires_at: null, privacy_protected: false, error: msg };
  }
}

// ── Public API ────────────────────────────────────────────────────────────
//
// skipFallback: pass true for typosquat batch checks to avoid firing a
// rdap.org fallback for every Verisign 404 (typosquat candidates are almost
// all genuinely unregistered — trust the 404, don't add 20 extra calls).

export async function checkDomainRdap(domain: string, skipFallback = false): Promise<RdapDomainResult> {
  // Ensure bootstrap is loaded before first real query
  await loadBootstrap();

  const url    = rdapEndpoint(domain);
  const result = await fetchRdap(url);

  // Two-tier for Verisign (.com/.net): some older registrations are only
  // indexed at the registrar level, not the registry level — Verisign returns
  // 404 even though the domain is live. Verify with rdap.org before reporting
  // "available". Not applied for typosquat checks (skipFallback=true).
  const isVerisign = url.includes("verisign");
  if (isVerisign && !result.registered && !result.error && !skipFallback) {
    return fetchRdap(RDAP_PROXY + domain);
  }

  return result;
}
