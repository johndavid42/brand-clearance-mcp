import type { TrademarkHit, TrademarkSearchResult, TrademarkStatus } from "./types.js";
import { similarityScore, conflictLevel, normalizeBrandName } from "./similarity.js";

// ── EUIPO Trademark Search API v1.1.0 ─────────────────────────────────────
// Official developer portal: https://dev.euipo.europa.eu
// OAuth2 client_credentials flow — no user interaction needed for search.
// Register free at dev.euipo.europa.eu, subscribe to "Trademark search 1.1.0".
// Production approval requires ID documents submitted to docs.apiplatform@euipo.europa.eu.
// Sandbox (EUIPO_SANDBOX=true) returns test data for auth/structure testing only.
//
// Required env vars:
//   EUIPO_CLIENT_ID     — client_id from your registered app
//   EUIPO_CLIENT_SECRET — client_secret from your registered app
//   EUIPO_SANDBOX       — "true" for sandbox, omit for production

const IS_SANDBOX = process.env.EUIPO_SANDBOX === "true";

const AUTH_URL = IS_SANDBOX
  ? "https://auth-sandbox.euipo.europa.eu/oidc/accessToken"
  : "https://auth.euipo.europa.eu/oidc/accessToken";

const API_BASE = IS_SANDBOX
  ? "https://api-sandbox.euipo.europa.eu/trademark-search"
  : "https://api.euipo.europa.eu/trademark-search";

// ── Token cache — tokens last 2hrs, refresh 5 min early ──────────────────

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      grant_type:    "client_credentials",
      scope:         "uid",
    }),
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) throw new Error(`EUIPO auth HTTP ${res.status}`);
  const data = await res.json() as { access_token: string; expires_in: number };

  cachedToken      = data.access_token;
  tokenExpiresAt   = Date.now() + (data.expires_in - 300) * 1000;
  return cachedToken;
}

// ── Response types (confirmed from API spec + sandbox) ────────────────────

interface EuipoTrademark {
  applicationNumber?: string;
  markFeature?: string;
  niceClasses?: number[];
  wordMarkSpecification?: { verbalElement?: string };
  applicants?: Array<{ name?: string; identifier?: string }>;
  applicationDate?: string;
  registrationDate?: string;
  expiryDate?: string;
  status?: string; // REGISTERED | FILED | EXPIRED | WITHDRAWN
}

interface EuipoResponse {
  trademarks: EuipoTrademark[];
  totalElements: number;
  size: number;
  page: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function parseStatus(s: string | undefined): TrademarkStatus {
  switch ((s ?? "").toUpperCase()) {
    case "REGISTERED": return "REGISTERED";
    case "FILED":      return "PENDING";
    case "EXPIRED":    return "DEAD";
    case "WITHDRAWN":  return "DEAD";
    default:           return "UNKNOWN";
  }
}

// Strip RSQL reserved characters from user input before embedding in query
function safeRsql(input: string): string {
  return input.replace(/['"();,=!~<>*]/g, " ").trim();
}

// ── Public API ────────────────────────────────────────────────────────────

export async function searchEuipoTrademarks(
  brandName: string,
  rows = 20,
): Promise<TrademarkSearchResult> {
  const clientId     = process.env.EUIPO_CLIENT_ID     ?? "";
  const clientSecret = process.env.EUIPO_CLIENT_SECRET ?? "";

  if (!clientId || !clientSecret) {
    return {
      hits: [],
      source: "EUIPO",
      total_found: 0,
      error: "EUIPO_CLIENT_ID / EUIPO_CLIENT_SECRET not set — register free at dev.euipo.europa.eu",
    };
  }

  try {
    const token = await getAccessToken(clientId, clientSecret);

    // RSQL query: wildcard verbal element match, active marks only.
    // Syntax confirmed from EUIPO API spec:
    //   wordMarkSpecification.verbalElement==*term* and status=in=(REGISTERED,FILED)
    const safe  = safeRsql(brandName);
    const rsql  = `wordMarkSpecification.verbalElement==*${safe}* and status=in=(REGISTERED,FILED)`;
    const size  = Math.min(Math.max(rows, 10), 100);

    const params = new URLSearchParams({
      query: rsql,
      page:  "0",
      size:  String(size),
      sort:  "wordMarkSpecification.verbalElement:asc",
    });

    const res = await fetch(`${API_BASE}/trademarks?${params}`, {
      headers: {
        Authorization:     `Bearer ${token}`,
        "X-IBM-Client-Id": clientId,
        Accept:            "application/json",
      },
      signal: AbortSignal.timeout(12_000),
    });

    if (res.status === 429) throw new Error("EUIPO rate limit exceeded — reduce request frequency");
    if (!res.ok)           throw new Error(`EUIPO API HTTP ${res.status}`);

    const data  = await res.json() as EuipoResponse;
    const marks = data.trademarks ?? [];

    const hits: TrademarkHit[] = marks.map(tm => {
      const name   = tm.wordMarkSpecification?.verbalElement ?? "";
      const score  = similarityScore(brandName, name);
      const owner  = tm.applicants?.find(a => a.name)?.name ?? null;
      const classes = tm.niceClasses?.map(n => String(n).padStart(3, "0")).join(", ") ?? null;

      return {
        source:              "EUIPO",
        mark_name:           name,
        similarity_score:    score,
        conflict_level:      conflictLevel(score),
        status:              parseStatus(tm.status),
        goods_class:         classes,
        goods_description:   null, // not in search results; call GET /trademarks/{id} for details
        owner,
        serial_number:       tm.applicationNumber ?? null,
        registration_number: tm.applicationNumber ?? null,
        filed_date:          tm.applicationDate   ?? null,
        registration_date:   tm.registrationDate  ?? null,
        jurisdiction:        "EU",
      };
    });

    const filtered = hits
      .filter(h => h.similarity_score >= 40 ||
        normalizeBrandName(h.mark_name) === normalizeBrandName(brandName))
      .sort((a, b) => b.similarity_score - a.similarity_score)
      .slice(0, rows);

    return { hits: filtered, source: "EUIPO", total_found: filtered.length, error: null };

  } catch (err) {
    return {
      hits: [],
      source: "EUIPO",
      total_found: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
