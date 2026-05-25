# brand-clearance-mcp

Pre-launch brand conflict clearance via MCP. One call returns a unified risk verdict across USPTO (US) and EUIPO (EU) trademark registries, domain availability across 7 TLDs, typosquat exposure, and global company name conflicts via GLEIF — normalized into a single typed report with a conflict_risk_score of HIGH / MEDIUM / LOW / CLEAR.

Replaces Trademarkia ($199/search) and LegalZoom Brand Protection ($299–$750/clearance package) with a programmatic, agent-callable API at $0.10/query.

## Data Sources

| Source | Coverage | Auth |
|---|---|---|
| USPTO TMSEARCH | US trademark registry — all live, dead, and pending marks | None (browser-style headers required) |
| EUIPO Trademark Search API v1.1.0 | EU trademark registry — registered and filed marks | OAuth2 client_credentials (free registration at dev.euipo.europa.eu) |
| RDAP (rdap.org) | Domain registration — 7 TLDs: .com .net .org .io .co .app .ai | None |
| RDAP typosquat check | Transpositions, omissions, doublings, homoglyphs, keyword variants (.com only) | None |
| GLEIF API | Global legal entity registry — 2.5M+ active entities, G20-endorsed LEI standard | None |
| Companies House | UK company registrations | Free key: developer.company-information.service.gov.uk |
| Direct HTTP fetch | Live vs parked page detection on brand.com | None |

## MCP Tools

### `check_brand_clearance`
Full pre-launch clearance report in one call. All 6 sources fire in parallel.

**Input:**
```json
{ "brand_name": "Luminary", "nice_class": 42 }
```

`nice_class` (optional, 1–45): If your product falls in a specific Nice classification (e.g. 9 = software downloads, 35 = business services, 42 = SaaS), trademark hits in different classes are downgraded one conflict level. Hits in the same class stay at their original level.

**Output:**
```json
{
  "conflict_risk_score": "HIGH",
  "conflict_summary": "HIGH CONFLICT RISK — Active USPTO trademark 'LUMINARY' (LIVE) is an exact match — owner: Luminary Legacy LLC. Do not proceed without legal clearance.",
  "trademark_hits": [
    {
      "source": "USPTO",
      "mark_name": "LUMINARY",
      "similarity_score": 100,
      "conflict_level": "EXACT",
      "status": "LIVE",
      "goods_class": "042",
      "goods_description": "Software as a service (SAAS) services...",
      "owner": "CLEAN CONNECT AI, INC.",
      "serial_number": "98828490",
      "filed_date": "2024-10-30T00:00:00",
      "jurisdiction": "US"
    }
  ],
  "domain_status": {
    "available_tlds": ["io", "co", "app"],
    "registered_tlds": ["com", "net", "org", "ai"]
  },
  "brand_web_metadata": {
    "live": true,
    "title": "Luminary | Digital agency in Australia",
    "parked": false
  },
  "typosquat_domains": [
    { "domain": "lumnary.com", "permutation_type": "typo_omission", "registered": true }
  ],
  "company_registrations": [
    { "source": "gleif", "name": "Luminary Real Estate LLC", "jurisdiction": "US", "status": "lapsed" }
  ],
  "risk_factors": [...],
  "latency_ms": 5316
}
```

### `search_trademarks`
USPTO and/or EUIPO trademark search only. Faster than the full clearance report when you only need trademark data.

**Input:** `{ "brand_name": "Luminary", "jurisdiction": "both", "nice_class": 42 }`

### `check_domain_conflicts`
Domain availability across 7 TLDs plus registered typosquat enumeration via RDAP.

**Input:** `{ "brand_name": "Clearpath" }`

### `search_company_names`
GLEIF global entity search (2.5M+ entities, free, no key) plus Companies House if key is set.

**Input:** `{ "brand_name": "Tidewake" }`

## Similarity Scoring

Levenshtein distance with legal-suffix stripping and Unicode normalization (NFD decompose → strip combining diacritics). "Café" and "Cafe" produce the same normalized form. Legal suffixes (Inc, LLC, Ltd, GmbH, etc.) are stripped before comparison so "Acme Inc" and "Acme LLC" are treated as the same brand.

Conflict levels: EXACT (100%), HIGH (≥85%), MEDIUM (≥70%), LOW (<70%).

GLEIF results use an additional prefix-boost: if the brand name appears at the start of the company name after normalization ("Luminary Real Estate LLC" starts with "luminary"), the score is raised to 75 minimum to ensure compound names surface as conflicts.

## Caching

In-memory Map cache with 24-hour TTL. All 6 data sources are fetched in parallel on first call per brand; subsequent calls return from cache in <10ms. `nice_class` re-weighting is applied as pure post-processing against cached raw hits — no additional fetches per class value.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No (default 3000) | Server port |
| `EUIPO_CLIENT_ID` | Yes (for EU trademarks) | Client ID from dev.euipo.europa.eu |
| `EUIPO_CLIENT_SECRET` | Yes (for EU trademarks) | Client secret |
| `EUIPO_SANDBOX` | No | Set to `"true"` for sandbox testing only |
| `COMPANIES_HOUSE_API_KEY` | No | Free key for UK company search |

GLEIF and RDAP require no credentials. USPTO uses public endpoints with browser-style headers.

## Running Locally

```bash
npm install
EUIPO_CLIENT_ID=xxx EUIPO_CLIENT_SECRET=yyy npm run dev
```

```bash
# Full clearance report
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"check_brand_clearance","arguments":{"brand_name":"Luminary"}}}' \
  | python3 -c "import sys,json; r=json.load(sys.stdin)['result']['structuredContent']; print(r['conflict_risk_score'], '|', r['conflict_summary'][:100])"

# Clean brand check
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"check_brand_clearance","arguments":{"brand_name":"Tidewake"}}}' \
  | python3 -c "import sys,json; r=json.load(sys.stdin)['result']['structuredContent']; print(r['conflict_risk_score'], '|', r['conflict_summary'])"
```

## Deployment (Railway)

```bash
# Push to GitHub, connect repo in Railway
# Set env vars: EUIPO_CLIENT_ID, EUIPO_CLIENT_SECRET
# Optional: COMPANIES_HOUSE_API_KEY (free at developer.company-information.service.gov.uk)
# Remove EUIPO_SANDBOX for production (sandbox returns test data only)
```

## Coverage Notes

**EUIPO production:** Requires ID verification. Submit documents to docs.apiplatform@euipo.europa.eu. Sandbox credentials work for auth/structure testing but return test data, not real EU trademark records.

**Company name coverage:** GLEIF covers entities with a Legal Entity Identifier — strong coverage for US and EU financial, corporate, and regulated entities. Private LLCs incorporated only at the state level without an LEI are outside GLEIF scope. No single free API provides complete US state-level company search.

**Domain typosquats:** Checked at .com only for permutations (transpositions, omissions, doublings, homoglyphs, keyword variants). Up to 20 RDAP lookups per brand. Only registered variants are returned.

## Not Legal Advice

This tool provides factual clearance data — trademark registry records, domain registration facts, and company name data from official sources. It does not constitute legal advice. Consult a trademark attorney before making naming decisions, particularly for HIGH conflict scores.
