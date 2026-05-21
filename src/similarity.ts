import type { RiskLevel, ConflictLevel, TrademarkHit, RiskFactor, TyposquatDomain, DomainRegistration, CompanyRegistration } from "./types.js";

// ── Levenshtein distance ──────────────────────────────────────────────────

export function levenshtein(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;

  // Use 1D array (space-optimized DP)
  let prev = Array.from({ length: lb + 1 }, (_, i) => i);
  let curr = new Array<number>(lb + 1);

  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,        // insertion
        prev[j] + 1,             // deletion
        prev[j - 1] + cost       // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[lb];
}

// ── Similarity score (0–100) ──────────────────────────────────────────────

export function similarityScore(a: string, b: string): number {
  const na = normalizeBrandName(a);
  const nb = normalizeBrandName(b);
  if (na === nb) return 100;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 100;
  return Math.round((1 - dist / maxLen) * 100);
}

// ── Brand name normalization ──────────────────────────────────────────────

// Legal suffix list — strip these before comparison so "Acme Inc" vs "Acme LLC"
// isn't counted as different brands.
const LEGAL_SUFFIXES = [
  /\b(inc\.?|incorporated|corp\.?|corporation|llc\.?|ltd\.?|limited|gmbh|ag|sa|srl|bv|nv|plc|co\.?)\b/gi,
];

export function normalizeBrandName(name: string): string {
  let n = name.toLowerCase().trim();
  // Strip legal suffixes
  for (const pat of LEGAL_SUFFIXES) n = n.replace(pat, "");
  // Strip punctuation except hyphens
  n = n.replace(/[^a-z0-9\-]/g, "");
  // Collapse whitespace
  n = n.replace(/\s+/g, " ").trim();
  return n;
}

// ── Conflict level from similarity score ──────────────────────────────────

export function conflictLevel(score: number): ConflictLevel {
  if (score === 100) return "EXACT";
  if (score >= 85)   return "HIGH";
  if (score >= 70)   return "MEDIUM";
  return "LOW";
}

// ── Overall risk score ────────────────────────────────────────────────────

export function computeOverallRisk(
  trademarkHits: TrademarkHit[],
  registeredDomains: DomainRegistration[],
  typosquats: TyposquatDomain[],
  companyHits: CompanyRegistration[],
): { score: RiskLevel; factors: RiskFactor[]; summary: string } {
  const factors: RiskFactor[] = [];

  // ── Trademark risk ───────────────────────────────────────────────────────
  const exactOrHigh = trademarkHits.filter(h => h.conflict_level === "EXACT" || h.conflict_level === "HIGH");
  const medium      = trademarkHits.filter(h => h.conflict_level === "MEDIUM");
  const liveExactOrHigh = exactOrHigh.filter(h => h.status === "LIVE" || h.status === "REGISTERED");

  if (liveExactOrHigh.length > 0) {
    const first = liveExactOrHigh[0];
    factors.push({
      type: "trademark_conflict",
      severity: "HIGH",
      description: `Active ${first.source} trademark "${first.mark_name}" (${first.status}) is ${first.conflict_level === "EXACT" ? "an exact match" : "highly similar"} — owner: ${first.owner ?? "unknown"}`,
      source: first.source,
    });
  } else if (exactOrHigh.length > 0) {
    const first = exactOrHigh[0];
    factors.push({
      type: "trademark_conflict",
      severity: "MEDIUM",
      description: `${first.source} trademark "${first.mark_name}" (${first.status}) is similar but status may not be active`,
      source: first.source,
    });
  } else if (medium.length > 0) {
    factors.push({
      type: "trademark_conflict",
      severity: "LOW",
      description: `${medium.length} moderately similar trademark(s) found — recommend attorney review`,
      source: "USPTO/EUIPO",
    });
  }

  // ── Domain risk ──────────────────────────────────────────────────────────
  const comRegistered = registeredDomains.find(d => d.tld === "com" && d.registered);
  if (comRegistered) {
    factors.push({
      type: "domain_taken",
      severity: liveExactOrHigh.length > 0 ? "HIGH" : "MEDIUM",
      description: `.com domain is already registered${comRegistered.registrar ? ` (${comRegistered.registrar})` : ""}`,
      source: "RDAP",
    });
  } else {
    const otherReg = registeredDomains.filter(d => d.registered && d.tld !== "com");
    if (otherReg.length > 0) {
      factors.push({
        type: "domain_taken",
        severity: "LOW",
        description: `${otherReg.map(d => `.${d.tld}`).join(", ")} registered but .com is available`,
        source: "RDAP",
      });
    }
  }

  // ── Typosquat risk ───────────────────────────────────────────────────────
  const registeredTypos = typosquats.filter(t => t.registered);
  if (registeredTypos.length >= 3) {
    factors.push({
      type: "typosquat_exposure",
      severity: "MEDIUM",
      description: `${registeredTypos.length} typosquat/variant domains already registered — brand impersonation risk`,
      source: "RDAP",
    });
  } else if (registeredTypos.length > 0) {
    factors.push({
      type: "typosquat_exposure",
      severity: "LOW",
      description: `${registeredTypos.length} variant domain(s) registered (${registeredTypos.map(t => t.domain).join(", ")})`,
      source: "RDAP",
    });
  }

  // ── Company name risk ────────────────────────────────────────────────────
  const exactCompany = companyHits.filter(c => c.similarity_score >= 90);
  if (exactCompany.length > 0) {
    factors.push({
      type: "company_name_conflict",
      severity: "MEDIUM",
      description: `Company "${exactCompany[0].name}" already registered in ${exactCompany[0].jurisdiction} with the same or very similar name`,
      source: exactCompany[0].source,
    });
  }

  // ── Overall score ────────────────────────────────────────────────────────
  const hasHigh   = factors.some(f => f.severity === "HIGH");
  const hasMedium = factors.some(f => f.severity === "MEDIUM");
  const hasLow    = factors.some(f => f.severity === "LOW");

  let score: RiskLevel;
  let summary: string;

  if (hasHigh) {
    score = "HIGH";
    const hf = factors.find(f => f.severity === "HIGH")!;
    summary = `HIGH CONFLICT RISK — ${hf.description}. Do not proceed without legal clearance.`;
  } else if (hasMedium) {
    score = "MEDIUM";
    summary = `MEDIUM CONFLICT RISK — ${factors.filter(f => f.severity === "MEDIUM").map(f => f.description).join("; ")}. Attorney review recommended.`;
  } else if (hasLow) {
    score = "LOW";
    summary = `LOW CONFLICT RISK — minor concerns: ${factors.map(f => f.description).join("; ")}. Monitor before launch.`;
  } else {
    score = "CLEAR";
    summary = "NO CONFLICTS FOUND — no active trademark matches, .com available, no company name conflicts. Standard monitoring recommended post-launch.";
  }

  return { score, factors, summary };
}
