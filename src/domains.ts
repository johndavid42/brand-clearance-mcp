import type { DomainStatus, DomainRegistration, TyposquatDomain, PermutationType } from "./types.js";
import { checkDomainRdap } from "./rdap.js";

// ── Primary TLDs to always check ──────────────────────────────────────────

const PRIMARY_TLDS = ["com", "net", "org", "io", "co", "app", "ai"];

// ── Keyboard adjacency map for typo generation ────────────────────────────

const ADJACENT: Record<string, string> = {
  a: "sqzw", b: "vghn", c: "xdfv", d: "serfcx", e: "wsdr",
  f: "drtgvc", g: "ftyh nb", h: "gyujnb", i: "ujko", j: "huikm",
  k: "jiol", l: "kop", m: "njk", n: "bhjm", o: "iklp",
  p: "lo", q: "wa", r: "edft", s: "aqwdxze", t: "rfgy",
  u: "yhji", v: "cfgb", w: "qase", x: "zsdc", y: "tghu",
  z: "asx",
};

// Homoglyphs — characters easily confused visually
const HOMOGLYPHS: Record<string, string[]> = {
  a: ["@", "4"], e: ["3"], i: ["1", "l"], l: ["1", "i"],
  o: ["0"], s: ["5", "$"], t: ["7"], g: ["9"], b: ["6"],
};

// ── Permutation generators ────────────────────────────────────────────────

function generateTypoTranspositions(name: string): string[] {
  const results: string[] = [];
  for (let i = 0; i < name.length - 1; i++) {
    const swapped = name.slice(0, i) + name[i + 1] + name[i] + name.slice(i + 2);
    if (swapped !== name) results.push(swapped);
  }
  return results;
}

function generateTypoOmissions(name: string): string[] {
  const results: string[] = [];
  for (let i = 0; i < name.length; i++) {
    const omitted = name.slice(0, i) + name.slice(i + 1);
    if (omitted.length >= 2) results.push(omitted);
  }
  return results;
}

function generateTypoDoublings(name: string): string[] {
  const results: string[] = [];
  for (let i = 0; i < name.length; i++) {
    const doubled = name.slice(0, i) + name[i] + name[i] + name.slice(i + 1);
    results.push(doubled);
  }
  return results;
}

function generateHomoglyphs(name: string): string[] {
  const results: string[] = [];
  for (let i = 0; i < name.length; i++) {
    const ch = name[i].toLowerCase();
    const alts = HOMOGLYPHS[ch] ?? [];
    for (const alt of alts) {
      // Only include if the result is still a valid domain label (alphanum/hyphen)
      const replaced = name.slice(0, i) + alt + name.slice(i + 1);
      if (/^[a-z0-9][a-z0-9-]*[a-z0-9]$/i.test(replaced) || /^[a-z0-9]$/i.test(replaced)) {
        results.push(replaced);
      }
    }
  }
  return results;
}

function generateKeywordVariants(name: string): string[] {
  const prefixes = ["get", "try", "use", "my", "the", "go"];
  const suffixes = ["app", "hq", "ai", "io", "api", "hub", "co"];
  return [
    ...prefixes.map(p => `${p}${name}`),
    ...suffixes.map(s => `${name}${s}`),
  ];
}

// ── Domain-safe filter ────────────────────────────────────────────────────

function isDomainSafe(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/i.test(name) && name.length >= 2;
}

// ── Typosquat check (RDAP in parallel, capped) ────────────────────────────

interface PermCandidate {
  name: string;
  type: PermutationType;
  riskNote: string;
}

function generateCandidates(brandName: string): PermCandidate[] {
  const clean = brandName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const candidates: PermCandidate[] = [];

  const add = (name: string, type: PermutationType, note: string) => {
    if (isDomainSafe(name) && name !== clean) {
      candidates.push({ name, type, riskNote: note });
    }
  };

  // Transpositions (e.g. "acme" → "acme" with char swap)
  for (const t of generateTypoTranspositions(clean)) {
    add(t, "typo_transposition", `Transposition of adjacent characters — common typing mistake for "${brandName}"`);
  }

  // Omissions (single char dropped)
  for (const t of generateTypoOmissions(clean)) {
    add(t, "typo_omission", `Single character omitted — squatter target for "${brandName}" traffic`);
  }

  // Doublings (single char doubled)
  for (const t of generateTypoDoublings(clean)) {
    add(t, "typo_doubling", `Double character — common autocorrect variant for "${brandName}"`);
  }

  // Homoglyphs (visual lookalikes — IDN abuse)
  for (const t of generateHomoglyphs(clean)) {
    add(t, "homoglyph", `Visually similar character substitution — phishing/IDN homograph risk`);
  }

  // Keyword variants (getbrand.com, brandhq.com etc.)
  for (const t of generateKeywordVariants(clean)) {
    add(t, "keyword_suffix", `Common brand keyword variant — often registered by squatters`);
  }

  // Deduplicate and cap
  const seen = new Set<string>();
  return candidates.filter(c => {
    if (seen.has(c.name)) return false;
    seen.add(c.name);
    return true;
  });
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function checkDomainAvailability(
  brandName: string,
  extraTlds: string[] = [],
): Promise<DomainStatus> {
  const clean = brandName.toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!clean) {
    return { checked_domains: [], available_tlds: [], registered_tlds: [], error: "Invalid brand name for domain check" };
  }

  const tlds = [...new Set([...PRIMARY_TLDS, ...extraTlds])];
  const domainList = tlds.map(tld => ({ domain: `${clean}.${tld}`, tld }));

  const results = await Promise.allSettled(
    domainList.map(async ({ domain, tld }) => {
      const r = await checkDomainRdap(domain);
      // Keep RdapDomainResult fields (including error) alongside domain/tld
      return { domain, tld, rdap: r };
    })
  );

  const rdapErrors: string[] = [];

  const checked: DomainRegistration[] = results.map((r, i) => {
    if (r.status === "fulfilled") {
      const { domain, tld, rdap } = r.value;
      if (rdap.error) {
        rdapErrors.push(`${domain}: ${rdap.error}`);
      }
      return {
        domain,
        tld,
        registered:        rdap.error ? false : rdap.registered,
        registrar:         rdap.registrar,
        registered_at:     rdap.registered_at,
        expires_at:        rdap.expires_at,
        privacy_protected: rdap.privacy_protected,
      };
    }
    rdapErrors.push(`${domainList[i].domain}: lookup rejected`);
    return {
      domain:            domainList[i].domain,
      tld:               tlds[i],
      registered:        false,
      registrar:         null,
      registered_at:     null,
      expires_at:        null,
      privacy_protected: false,
    };
  });

  // Only count domains as "available" if the RDAP check actually succeeded (no error)
  const successfulChecks = checked.filter((_, i) => {
    const r = results[i];
    return r.status === "fulfilled" && !(r as PromiseFulfilledResult<{rdap: {error: string|null}}>).value.rdap.error;
  });

  return {
    checked_domains: checked,
    available_tlds:  successfulChecks.filter(d => !d.registered).map(d => d.tld),
    registered_tlds: checked.filter(d => d.registered).map(d => d.tld),
    error: rdapErrors.length > 0 ? `RDAP check failed for: ${rdapErrors.join("; ")}` : null,
  };
}

export async function checkTyposquats(brandName: string): Promise<TyposquatDomain[]> {
  const candidates = generateCandidates(brandName);

  // Cap at 20 RDAP checks to keep latency manageable, prioritize high-value types
  const prioritized = [
    ...candidates.filter(c => c.type === "typo_transposition").slice(0, 5),
    ...candidates.filter(c => c.type === "typo_omission").slice(0, 4),
    ...candidates.filter(c => c.type === "keyword_suffix").slice(0, 6),
    ...candidates.filter(c => c.type === "typo_doubling").slice(0, 3),
    ...candidates.filter(c => c.type === "homoglyph").slice(0, 2),
  ].slice(0, 20);

  const results = await Promise.allSettled(
    prioritized.map(async c => {
      const domain = `${c.name}.com`; // check .com only for permutations
      const rdap = await checkDomainRdap(domain, true); // skipFallback — typosquats are almost all unregistered, avoid 20 extra rdap.org calls
      return {
        domain,
        permutation_type: c.type,
        registered: rdap.registered,
        registrar: rdap.registrar,
        risk_note: c.riskNote,
      } satisfies TyposquatDomain;
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<TyposquatDomain> => r.status === "fulfilled")
    .map(r => r.value)
    .filter(r => r.registered); // Only return registered ones — that's the risk signal
}
