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

const PRIVACY_PATTERNS = [
  /domains by proxy/i, /whoisguard/i, /privacy protect/i,
  /contactprivacy/i, /withheld for privacy/i, /redacted for privacy/i,
  /identity protection/i, /data protected/i, /private registration/i,
];

// ── Routing strategy ──────────────────────────────────────────────────────
//
// .com and .net  → Verisign registry RDAP (confirmed working, no rate limit
//                  under load, handles the bulk of typosquat checks which are
//                  all .com). Two-tier: Verisign first, rdap.org fallback for
//                  domains Verisign doesn't index (older registrations via
//                  certain registrars return 404 from registry RDAP).
//
// All other TLDs → rdap.org proxy directly. Avoiding guessed TLD-specific
//                  endpoints which have been unreachable in testing (.org PIR,
//                  .co NIC, .ai NIC, Identity Digital for .io/.app).
//                  The 5 non-.com TLD checks per brand are well within
//                  rdap.org limits since all high-volume .com calls go to
//                  Verisign.
//
// skipFallback=true → used by typosquat checks. Typosquat candidates are
//                     almost all genuinely unregistered; firing a rdap.org
//                     fallback for each Verisign 404 would send 20 extra
//                     requests per brand scan. Trust Verisign's 404 for
//                     recently-registered squatter domains.

const VERISIGN_COM = "https://rdap.verisign.com/com/v1/domain/";
const VERISIGN_NET = "https://rdap.verisign.com/net/v1/domain/";
const RDAP_PROXY   = "https://rdap.org/domain/";

function primaryEndpoint(domain: string): string {
  const tld = domain.split(".").pop()?.toLowerCase() ?? "";
  if (tld === "com") return VERISIGN_COM + domain;
  if (tld === "net") return VERISIGN_NET + domain;
  return RDAP_PROXY + domain;
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
// skipFallback: pass true for typosquat batch checks to avoid firing
// a rdap.org fallback for every Verisign 404 (almost all typosquat
// candidates are genuinely unregistered).

export async function checkDomainRdap(domain: string, skipFallback = false): Promise<RdapDomainResult> {
  const url    = primaryEndpoint(domain);
  const result = await fetchRdap(url);

  // Two-tier: if Verisign (.com/.net) returned clean 404, verify via rdap.org
  // to rule out registry RDAP coverage gaps before reporting "available".
  // Not applied for typosquat checks (skipFallback=true) to avoid 20 extra
  // rdap.org calls per scan.
  const isVerisign = url.includes("verisign");
  if (isVerisign && !result.registered && !result.error && !skipFallback) {
    return fetchRdap(RDAP_PROXY + domain);
  }

  return result;
}
