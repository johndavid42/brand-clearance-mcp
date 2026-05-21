import type { TrademarkHit, TrademarkSearchResult, TrademarkStatus } from "./types.js";
import { similarityScore, conflictLevel, normalizeBrandName } from "./similarity.js";

// ── USPTO TMSEARCH — confirmed working endpoint ───────────────────────────
// Discovered via browser DevTools on tmsearch.uspto.gov.
// POST with Elasticsearch query body. Requires browser-style headers —
// CloudFront blocks requests without Origin + Referer headers.

const TMSEARCH_URL = "https://tmsearch.uspto.gov/prod-stage-v1-0-0/tmsearch";

// ── Confirmed response field names (from live Nike test) ──────────────────

interface TmsearchSource {
  wordmark?: string;
  wordmarkPseudoText?: string;  // fallback mark name field
  markDescription?: string;     // second fallback
  ownerName?: string[];
  filedDate?: string;
  registrationDate?: string | null;
  registrationId?: string;      // registration number
  internationalClass?: string[];
  goodsAndServices?: string[];
  alive?: boolean;
}

interface TmsearchHit {
  id?: string;           // serial number
  score?: number;
  source?: TmsearchSource;
}

interface TmsearchResponse {
  hits?: {
    totalValue?: number;
    hits?: TmsearchHit[];
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────

function parseAlive(alive: boolean | undefined, goodsAndServices: string[] | undefined): TrademarkStatus {
  if (alive === true)  return "LIVE";
  if (alive === false) return "DEAD";
  // Fallback: check goods description for "(ABANDONED)" prefix
  if (goodsAndServices?.some(g => /^\(ABANDONED\)/i.test(g))) return "DEAD";
  return "UNKNOWN";
}

function parseOwner(ownerName: string[] | undefined): string | null {
  if (!ownerName?.length) return null;
  // Strip the parenthetical: "Nike, Inc. (CORPORATION; OREGON, USA)" → "Nike, Inc."
  return ownerName[0].replace(/\s*\([^)]+\)\s*$/, "").trim() || null;
}

function parseClass(intlClass: string[] | undefined): string | null {
  if (!intlClass?.length) return null;
  // "IC 014" → "014", join multiples
  return intlClass.map(c => c.replace(/^IC\s*/i, "").trim()).join(", ");
}

function parseGoods(goodsAndServices: string[] | undefined): string | null {
  if (!goodsAndServices?.length) return null;
  // Strip leading status prefix e.g. "(ABANDONED) IC 014: " → actual goods description
  const cleaned = goodsAndServices
    .map(g => g.replace(/^\([^)]+\)\s*IC\s*\d+:\s*/i, "").trim())
    .filter(Boolean)
    .join("; ");
  return cleaned.slice(0, 300) || null;
}

// ── ES query builder — matches tmsearch.uspto.gov portal behaviour ─────────

function buildQuery(term: string, size: number): string {
  const q = term.toLowerCase();
  return JSON.stringify({
    query: {
      bool: {
        must: [{
          bool: {
            should: [
              { match_phrase: { WM: { query: q, boost: 5 } } },
              { match:        { WM: { query: q, boost: 2 } } },
              { match_phrase: { PM: { query: q, boost: 2 } } },
            ],
          },
        }],
      },
    },
    // Use 100 like the portal — some exact marks appear further down the
    // relevance list when there are many compound marks containing the term
    size: Math.max(size, 100),
    from: 0,
    track_total_hits: true,
    _source: [
      "wordmark",
      "wordmarkPseudoText", // fallback — some marks only populate this field
      "markDescription",    // second fallback for design marks
      "ownerName",
      "filedDate",
      "registrationDate",
      "registrationId",
      "internationalClass",
      "goodsAndServices",
      "alive",
      "id",
    ],
  });
}

// ── Public API ────────────────────────────────────────────────────────────

export async function searchUsptoTrademarks(
  brandName: string,
  rows = 20,
): Promise<TrademarkSearchResult> {
  try {
    const res = await fetch(TMSEARCH_URL, {
      method: "POST",
      signal: AbortSignal.timeout(12_000),
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        "Origin": "https://tmsearch.uspto.gov",
        "Referer": "https://tmsearch.uspto.gov/",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      body: buildQuery(brandName, rows),
    });

    if (!res.ok) throw new Error(`USPTO TMSEARCH HTTP ${res.status}`);

    const data = await res.json() as TmsearchResponse;
    const raw  = data.hits?.hits ?? [];

    const hits: TrademarkHit[] = raw.map(hit => {
      const src  = hit.source ?? {};
      // wordmark is the primary field; some records only populate wordmarkPseudoText
      const name = src.wordmark || src.wordmarkPseudoText || src.markDescription || "";
      const score = similarityScore(brandName, name);
      return {
        source:              "USPTO",
        mark_name:           name,
        similarity_score:    score,
        conflict_level:      conflictLevel(score),
        status:              parseAlive(src.alive, src.goodsAndServices),
        goods_class:         parseClass(src.internationalClass),
        goods_description:   parseGoods(src.goodsAndServices),
        owner:               parseOwner(src.ownerName),
        serial_number:       hit.id ?? null,
        registration_number: src.registrationId ?? null,
        filed_date:          src.filedDate ?? null,
        registration_date:   src.registrationDate ?? null,
        jurisdiction:        "US",
      };
    });

    const filtered = hits
      .filter(h => h.similarity_score >= 40 ||
        normalizeBrandName(h.mark_name) === normalizeBrandName(brandName))
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
