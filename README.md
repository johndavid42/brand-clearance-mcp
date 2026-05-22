# Brand Clearance Intelligence MCP

**Pre-launch brand conflict clearance in one call.** USPTO + EUIPO trademark registries, domain availability across 7 TLDs, typosquat exposure, company registrations, and live web metadata — normalized into a single risk signal.

Listed on the [Context marketplace](https://ctxprotocol.com).

## What it replaces

| Tool | Cost | What it provided |
|---|---|---|
| Trademarkia | $199/search report | USPTO/EUIPO trademark lookup |
| LegalZoom Brand Protection | $299–$750/clearance | Manual clearance package |
| Thomson CompuMark / Clarifip | $1,000+/year | IP attorney conflict analysis |

This MCP returns the factual clearance data that attorneys and founders currently assemble manually across 4–5 separate tools, in one programmatic call, in under 20 seconds.

## Data sources

| Signal | Source | Auth |
|---|---|---|
| US trademarks | USPTO open data API + IBD fallback | None |
| EU trademarks | EUIPO Trademark Search API v1.1.0 (dev.euipo.europa.eu) | OAuth2 client_credentials — free registration, production requires ID docs |
| Domain availability | ICANN RDAP (7 TLDs) | None |
| Typosquat exposure | Custom permutation engine + RDAP | None |
| Company registrations | OpenCorporates (global) | None |
| Company registrations (UK) | Companies House REST API | Optional free key |
| Web metadata | Direct HTTP fetch of brand.com | None |

**Zero paid APIs. All sources are official, free, and publicly documented.**

## Tools

| Tool | Description | Latency |
|---|---|---|
| `check_brand_clearance` | Full report: trademarks, domains, typosquats, companies, risk score | sub-200ms cached / 10–20s cold |
| `search_trademarks` | USPTO + EUIPO trademark hits only, filterable by jurisdiction | sub-200ms (shares cache) |
| `check_domain_conflicts` | Domain availability (7 TLDs) + registered typosquat variants | sub-200ms (shares cache) |
| `search_company_names` | Companies House (UK) + OpenCorporates company name conflicts | sub-200ms (shares cache) |

All 4 tools share a 24h in-memory domain cache. First call for a brand pays the cold penalty; all subsequent calls are instant.

## Risk scoring

The `conflict_risk_score` field returns one of four verdicts:

| Score | Meaning | Recommendation |
|---|---|---|
| `HIGH` | Active trademark conflict or .com owned by a live business | Do not proceed without legal clearance |
| `MEDIUM` | Similar marks, .com taken, or company name conflict | Attorney review recommended |
| `LOW` | Minor concerns — inactive marks, parked domains | Monitor before launch |
| `CLEAR` | No conflicts found | Standard post-launch monitoring |

The `risk_factors` array explains exactly what drove the score.

## Run locally

```bash
npm install
npm run dev
```

Test with a brand known to have conflicts:

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","id":1,"params":{"name":"check_brand_clearance","arguments":{"brand_name":"Apex"}}}' \
  | jq '{score: .result.structuredContent.conflict_risk_score, summary: .result.structuredContent.conflict_summary}'
```

Test with a clean invented name:

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","id":1,"params":{"name":"check_brand_clearance","arguments":{"brand_name":"Tidewake"}}}' \
  | jq '{score: .result.structuredContent.conflict_risk_score, hits: (.result.structuredContent.trademark_hits | length), web: .result.structuredContent.brand_web_metadata}'
```

> **Note:** `tools/call` returns `{"error":"Unauthorized"}` locally because `createContextMiddleware()` requires a valid CTX JWT. Comment it out in `server.ts` for local testing, or use the first curl (remove auth) approach above.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No (default: 3000) | Server port |
| `NODE_ENV` | No (default: development) | Environment |
| `EUIPO_CLIENT_ID` | No | Client ID from your registered app at dev.euipo.europa.eu. Without this, EU trademark search is skipped. |
| `EUIPO_CLIENT_SECRET` | No | Client secret from your registered app. |
| `EUIPO_SANDBOX` | No | Set to `"true"` to use sandbox environment during development. Sandbox returns test data only — use production for real trademark searches. |
| `COMPANIES_HOUSE_API_KEY` | No | Free key from [Companies House developer portal](https://developer.company-information.service.gov.uk/). If absent, UK company search is skipped; OpenCorporates still runs. |

### Setting up EUIPO access

1. Register a free account at `https://euipo.europa.eu/ohimportal/en/web/guest/login?loginmode=register`
2. Log into `https://dev.euipo.europa.eu` and register an application under Apps
3. Subscribe to **Trademark search 1.1.0** — sandbox approval is immediate, production requires submitting ID documents to `docs.apiplatform@euipo.europa.eu`
4. Set `EUIPO_CLIENT_ID` and `EUIPO_CLIENT_SECRET` from your registered app
5. Set `EUIPO_SANDBOX=true` during development; remove it for production

## Deploy

### Railway (recommended)

Push to GitHub → connect repo → set `COMPANIES_HOUSE_API_KEY` env var (optional) → Railway uses `nixpacks.toml` to build and start automatically.

### Hetzner CX22 (~€4/mo)

```bash
npm run build
node dist/server.js
```

Expose via Caddy or nginx for HTTPS.

## Architecture

```
POST tools/call
      ↓
fetcher.ts:runBrandClearance(brandName)
      ↓ parallel Promise.all (all 6 sources simultaneously)
  ┌───────┬────────┬────────────┬──────────────┬──────────┬──────────┐
  ↓       ↓        ↓            ↓              ↓          ↓          ↓
uspto.ts euipo.ts domains.ts  domains.ts   companies.ts webcheck.ts
(USPTO) (EUIPO) (7 TLD RDAP) (typosquats)  (CH + OC)  (brand.com)
  └───────┴────────┴────────────┴──────────────┴──────────┴──────────┘
      ↓
similarity.ts:computeOverallRisk()
      ↓
BrandClearanceReport → Cache 24h → Return
```

Similarity scoring uses Levenshtein distance with legal suffix stripping (Inc, LLC, Ltd, GmbH etc. stripped before comparison so "Acme Inc" matches "Acme LLC" correctly).
