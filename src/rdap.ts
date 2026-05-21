import type { RdapDomainResult } from "./types.js";

interface RdapEvent {
  eventAction: string;
  eventDate: string;
}

interface RdapEntity {
  roles: string[];
  vcardArray?: unknown[];
}

interface RdapResponse {
  events?: RdapEvent[];
  entities?: RdapEntity[];
  status?: string[];
}

const PRIVACY_PATTERNS = [
  /domains by proxy/i, /whoisguard/i, /privacy protect/i,
  /contactprivacy/i, /withheld for privacy/i, /redacted for privacy/i,
  /identity protection/i, /data protected/i, /private registration/i,
];

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

export async function checkDomainRdap(domain: string): Promise<RdapDomainResult> {
  try {
    const res = await fetch(`https://rdap.org/domain/${domain}`, {
      signal: AbortSignal.timeout(6_000),
      headers: { Accept: "application/rdap+json" },
    });

    if (res.status === 404) {
      return { registered: false, registrar: null, registered_at: null, expires_at: null, privacy_protected: false, error: null };
    }
    if (!res.ok) throw new Error(`RDAP HTTP ${res.status}`);

    const data = await res.json() as RdapResponse;
    const events   = data.events ?? [];
    const entities = data.entities ?? [];

    return {
      registered:        true,
      registrar:         getRegistrar(entities),
      registered_at:     getEvent(events, "registration"),
      expires_at:        getEvent(events, "expiration"),
      privacy_protected: isPrivate(entities),
      error: null,
    };
  } catch (err) {
    // Distinguish "domain not found" from real errors
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("404")) {
      return { registered: false, registrar: null, registered_at: null, expires_at: null, privacy_protected: false, error: null };
    }
    return { registered: false, registrar: null, registered_at: null, expires_at: null, privacy_protected: false, error: msg };
  }
}
