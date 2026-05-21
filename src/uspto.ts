import type { TrademarkHit, TrademarkSearchResult, TrademarkStatus } from "./types.js";
import { similarityScore, conflictLevel, normalizeBrandName } from "./similarity.js";

// ── USPTO API ─────────────────────────────────────────────────────────────
// USPTO Trademark Search API — official, free, no auth required.
// https://developer.uspto.gov/api-catalog/trademark-search-api
//
// Primary endpoint: TMSEARCH full-text search
// Fallback endpoint: IBD open data trademark application search

const PRIMARY_URL   = "https://developer.uspto.gov/trademark/v1/marks";
const FALLBACK_URL  = "https://developer.uspto.gov/ibd-api/v1/trademark/application";

interface UsptoMark {
  markIdentification?: string;
  markLiteralElements?: string;
  trademarkOwner?: string | { partyName?: string }[];
  statusCode?: string;
  statusDate?: string;
  filingDate?: string;
  registrationDate?: string;
  serialNumber?: string;
  registrationNumber?: string;
  goodsAndServices?: string;
  internationalClassNumber?: string;
  classifications?: Array<{ intClassNumber?: string; goodsServices?: string }>;
}

interface UsptoIbdMark {
  markLiteralElements?: string;
  applicantName?: string;
  statusCode?: string;
  filingDate?: string;
  registrationDate?: string;
  serialNumber?: string;
  registrationNumber?: string;
  goodsAndServicesDescription?: string;
  internationalClassNumber?: string;
}

function parseStatus(code: string | undefined): TrademarkStatus {
  if (!code) return "UNKNOWN";
  const c = code.toUpperCase();
  if (c.includes("REGISTERED") || c === "4" || c.startsWith("REG")) return "REGISTERED";
  if (c.includes("LIVE") || c.includes("ACTIVE") || c === "3") return "LIVE";
  if (c.includes("DEAD") || c.includes("ABANDON") || c.includes("CANCEL") || c === "6") return "DEAD";
  if (c.includes("PEND") || c === "1" || c === "2") return "PENDING";
  return "UNKNOWN";
}

function parseOwner(raw: string | { partyName?: string }[] | undefined): string | null {
  if (!raw) return null;
  if (typeof raw === "string") return raw.trim() || null;
  if (Array.isArray(raw) && raw.length > 0) return raw[0].partyName?.trim() ?? null;
  return null;
}

function buildHit(mark: UsptoMark | UsptoIbdMark, brandName: string, isIbd = false): TrademarkHit {
  const name = ("markLiteralElements" in mark ? mark.markLiteralElements : mark.markLiteralElements) ?? "";
  const score = similarityScore(brandName, name);

  const goodsClass = isIbd
    ? (mark as UsptoIbdMark).internationalClassNumber ?? null
    : (() => {
        const m = mark as UsptoMark;
        if (m.classifications?.length) {
          return m.classifications.map(c => c.intClassNumber).filter(Boolean).join(", ");
        }
        return m.internationalClassNumber ?? null;
      })();

  const goodsDesc = isIbd
    ? (mark as UsptoIbdMark).goodsAndServicesDescription ?? null
    : (() => {
        const m = mark as UsptoMark;
        if (m.classifications?.length) {
          return m.classifications.map(c => c.goodsServices).filter(Boolean).join("; ") || null;
        }
        return m.goodsAndServices ?? null;
      })();

  return {
    source: "USPTO",
    mark_name: name,
    similarity_score: score,
    conflict_level: conflictLevel(score),
    status: parseStatus(isIbd ? (mark as UsptoIbdMark).statusCode : (mark as UsptoMark).statusCode),
    goods_class: goodsClass,
    goods_description: goodsDesc ? goodsDesc.slice(0, 200) : null,
    owner: isIbd ? ((mark as UsptoIbdMark).applicantName ?? null) : parseOwner((mark as UsptoMark).trademarkOwner),
    serial_number: mark.serialNumber ?? null,
    registration_number: mark.registrationNumber ?? null,
    filed_date: mark.filingDate ?? null,
    registration_date: mark.registrationDate ?? null,
    jurisdiction: "US",
  };
}

// ── Primary search ────────────────────────────────────────────────────────

async function searchPrimary(name: string, rows: number): Promise<UsptoMark[]> {
  const params = new URLSearchParams({
    query: name,
    rows: String(rows),
    start: "0",
  });
  const url = `${PRIMARY_URL}?${params}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`USPTO primary HTTP ${res.status}`);
  const data = await res.json() as { marks?: UsptoMark[]; trademarks?: UsptoMark[] };
  return data.marks ?? data.trademarks ?? [];
}

// ── Fallback IBD search ───────────────────────────────────────────────────

async function searchFallback(name: string, rows: number): Promise<UsptoIbdMark[]> {
  const params = new URLSearchParams({
    searchPhrase: name,
    rows: String(rows),
    start: "0",
  });
  const url = `${FALLBACK_URL}?${params}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`USPTO fallback HTTP ${res.status}`);
  const data = await res.json() as { results?: { trademarks?: UsptoIbdMark[] }; trademarks?: UsptoIbdMark[] };
  return data.results?.trademarks ?? data.trademarks ?? [];
}

// ── Public API ────────────────────────────────────────────────────────────

export async function searchUsptoTrademarks(
  brandName: string,
  rows = 20,
): Promise<TrademarkSearchResult> {
  try {
    let hits: TrademarkHit[] = [];

    try {
      const marks = await searchPrimary(brandName, rows);
      hits = marks.map(m => buildHit(m, brandName, false));
    } catch {
      // Primary failed — try IBD fallback
      const marks = await searchFallback(brandName, rows);
      hits = marks.map(m => buildHit(m, brandName, true));
    }

    // Filter to only meaningful similarity (>= 40%) and sort by score desc
    const filtered = hits
      .filter(h => h.similarity_score >= 40 || normalizeBrandName(h.mark_name) === normalizeBrandName(brandName))
      .sort((a, b) => b.similarity_score - a.similarity_score)
      .slice(0, rows);

    return { hits: filtered, source: "USPTO", total_found: filtered.length, error: null };
  } catch (err) {
    return {
      hits: [],
      source: "USPTO",
      total_found: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
