import type { TrademarkHit, TrademarkSearchResult, TrademarkStatus } from "./types.js";
import { similarityScore, conflictLevel, normalizeBrandName } from "./similarity.js";

// ── EUIPO eSearch Plus REST API ───────────────────────────────────────────
// Official, free, no auth required.
// https://euipo.europa.eu/eSearch/
// REST API: https://euipo.europa.eu/eSearch/rest/trademark/search

const BASE_URL = "https://euipo.europa.eu/eSearch/rest/trademark/search";

interface EuipoMark {
  applicationNumber?: string;
  registrationNumber?: string;
  trademarkName?: string;
  wordMark?: string;
  markBasis?: string;
  trademarkStatus?: string;
  applicationDate?: string;
  registrationDate?: string;
  niceClasses?: number[] | string[];
  goodsAndServices?: string;
  trademarkOwners?: Array<{ ownerName?: string; applicantName?: string; name?: string }>;
  trademarkApplicants?: Array<{ ownerName?: string; applicantName?: string; name?: string }>;
}

interface EuipoResponse {
  trademarks?: EuipoMark[];
  results?: EuipoMark[];
  total?: number;
  hits?: { hits?: Array<{ _source?: EuipoMark }> };
}

function parseEuipoStatus(raw: string | undefined): TrademarkStatus {
  if (!raw) return "UNKNOWN";
  const s = raw.toUpperCase();
  if (s.includes("REGISTERED"))  return "REGISTERED";
  if (s.includes("FILED") || s.includes("PENDING") || s.includes("EXAMINATION")) return "PENDING";
  if (s.includes("REFUSED") || s.includes("WITHDRAWN") || s.includes("LAPSED")) return "DEAD";
  if (s.includes("LIVE") || s.includes("ACTIVE")) return "LIVE";
  return "UNKNOWN";
}

function parseEuipoOwner(mark: EuipoMark): string | null {
  const owners = mark.trademarkOwners ?? mark.trademarkApplicants;
  if (!owners || owners.length === 0) return null;
  return owners[0].ownerName ?? owners[0].applicantName ?? owners[0].name ?? null;
}

function buildHit(mark: EuipoMark, brandName: string): TrademarkHit {
  const name = mark.trademarkName ?? mark.wordMark ?? "";
  const score = similarityScore(brandName, name);
  const classes = mark.niceClasses?.map(String).join(", ") ?? null;

  return {
    source: "EUIPO",
    mark_name: name,
    similarity_score: score,
    conflict_level: conflictLevel(score),
    status: parseEuipoStatus(mark.trademarkStatus),
    goods_class: classes,
    goods_description: mark.goodsAndServices ? mark.goodsAndServices.slice(0, 200) : null,
    owner: parseEuipoOwner(mark),
    serial_number: mark.applicationNumber ?? null,
    registration_number: mark.registrationNumber ?? null,
    filed_date: mark.applicationDate ?? null,
    registration_date: mark.registrationDate ?? null,
    jurisdiction: "EU",
  };
}

export async function searchEuipoTrademarks(
  brandName: string,
  rows = 20,
): Promise<TrademarkSearchResult> {
  try {
    const params = new URLSearchParams({
      query: brandName,
      start: "0",
      rows: String(rows),
      lang: "en",
      basicSearch: "true",
    });
    const url = `${BASE_URL}?${params}`;

    const res = await fetch(url, {
      signal: AbortSignal.timeout(12_000),
      headers: {
        Accept: "application/json",
        "User-Agent": "BrandClearanceMCP/1.0 (ctxprotocol.com contributor)",
      },
    });

    if (!res.ok) throw new Error(`EUIPO HTTP ${res.status}`);

    const data = await res.json() as EuipoResponse;

    // Handle different possible response shapes
    let marks: EuipoMark[] = [];
    if (Array.isArray(data.trademarks)) {
      marks = data.trademarks;
    } else if (Array.isArray(data.results)) {
      marks = data.results;
    } else if (data.hits?.hits) {
      marks = data.hits.hits.map(h => h._source).filter((s): s is EuipoMark => !!s);
    }

    const hits = marks
      .map(m => buildHit(m, brandName))
      .filter(h => h.similarity_score >= 40 || normalizeBrandName(h.mark_name) === normalizeBrandName(brandName))
      .sort((a, b) => b.similarity_score - a.similarity_score)
      .slice(0, rows);

    return { hits, source: "EUIPO", total_found: hits.length, error: null };
  } catch (err) {
    return {
      hits: [],
      source: "EUIPO",
      total_found: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
