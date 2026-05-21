// ── Shared sub-schemas ─────────────────────────────────────────────────────

const TRADEMARK_HIT_SCHEMA = {
  type: "object",
  properties: {
    source:              { type: "string", enum: ["USPTO", "EUIPO"], description: "Registry that returned this hit" },
    mark_name:           { type: "string", description: "Registered trademark name" },
    similarity_score:    { type: "number", description: "Levenshtein-based similarity to queried brand name (0–100). 100 = exact match." },
    conflict_level:      { type: "string", enum: ["EXACT", "HIGH", "MEDIUM", "LOW"], description: "EXACT=100%, HIGH≥85%, MEDIUM≥70%, LOW<70%" },
    status:              { type: "string", enum: ["LIVE", "DEAD", "PENDING", "REGISTERED", "UNKNOWN"], description: "Current trademark status. LIVE/REGISTERED = active conflict." },
    goods_class:         { type: ["string", "null"], description: "Nice classification number(s), e.g. '9, 42'. Null if not available." },
    goods_description:   { type: ["string", "null"], description: "Goods and services description (truncated to 200 chars)" },
    owner:               { type: ["string", "null"], description: "Current trademark owner or applicant" },
    serial_number:       { type: ["string", "null"], description: "USPTO serial number or EUIPO application number" },
    registration_number: { type: ["string", "null"] },
    filed_date:          { type: ["string", "null"], description: "Filing date (ISO 8601 or registry format)" },
    registration_date:   { type: ["string", "null"] },
    jurisdiction:        { type: "string", description: "'US' or 'EU'" },
  },
  required: ["source", "mark_name", "similarity_score", "conflict_level", "status", "goods_class", "goods_description", "owner", "serial_number", "registration_number", "filed_date", "registration_date", "jurisdiction"],
};

const DOMAIN_REGISTRATION_SCHEMA = {
  type: "object",
  properties: {
    domain:            { type: "string", description: "Full domain (e.g. 'acme.com')" },
    tld:               { type: "string", description: "TLD checked (e.g. 'com')" },
    registered:        { type: "boolean", description: "Whether this domain is currently registered" },
    registrar:         { type: ["string", "null"] },
    registered_at:     { type: ["string", "null"], description: "Registration date (ISO 8601)" },
    expires_at:        { type: ["string", "null"] },
    privacy_protected: { type: "boolean", description: "Whether WHOIS contact info is hidden" },
  },
  required: ["domain", "tld", "registered", "registrar", "registered_at", "expires_at", "privacy_protected"],
};

const TYPOSQUAT_SCHEMA = {
  type: "object",
  properties: {
    domain:           { type: "string", description: "The typosquat/variant domain (always .com)" },
    permutation_type: { type: "string", enum: ["tld_variation", "typo_transposition", "typo_omission", "typo_doubling", "keyword_prefix", "keyword_suffix", "homoglyph"] },
    registered:       { type: "boolean" },
    registrar:        { type: ["string", "null"] },
    risk_note:        { type: "string", description: "Why this permutation matters (impersonation, traffic hijack, etc.)" },
  },
  required: ["domain", "permutation_type", "registered", "registrar", "risk_note"],
};

const COMPANY_REGISTRATION_SCHEMA = {
  type: "object",
  properties: {
    source:           { type: "string", enum: ["companies_house", "opencorporates"] },
    name:             { type: "string", description: "Registered company name" },
    similarity_score: { type: "number", description: "Similarity to queried brand name (0–100)" },
    jurisdiction:     { type: "string", description: "Country/jurisdiction code (e.g. 'GB', 'US')" },
    company_number:   { type: ["string", "null"] },
    status:           { type: ["string", "null"], description: "Company status (e.g. 'active', 'dissolved')" },
    incorporated_on:  { type: ["string", "null"] },
    company_type:     { type: ["string", "null"] },
  },
  required: ["source", "name", "similarity_score", "jurisdiction", "company_number", "status", "incorporated_on", "company_type"],
};

const RISK_FACTOR_SCHEMA = {
  type: "object",
  properties: {
    type:        { type: "string", enum: ["trademark_conflict", "domain_taken", "company_name_conflict", "typosquat_exposure"] },
    severity:    { type: "string", enum: ["HIGH", "MEDIUM", "LOW", "CLEAR"] },
    description: { type: "string", description: "Human-readable description of the risk" },
    source:      { type: "string", description: "Data source (e.g. 'USPTO', 'RDAP')" },
  },
  required: ["type", "severity", "description", "source"],
};

const BRAND_WEB_METADATA_SCHEMA = {
  type: "object",
  description: "HTTP fetch of the brand's .com domain — reveals live business vs parked page",
  properties: {
    checked_url:  { type: ["string", "null"], description: "URL checked (e.g. 'https://luminary.com')" },
    live:         { type: "boolean", description: "Whether the domain resolves to an active page (HTTP 200/redirect)" },
    status_code:  { type: ["number", "null"] },
    title:        { type: ["string", "null"], description: "Page <title> — reveals if it's a live business" },
    description:  { type: ["string", "null"], description: "Meta description" },
    parked:       { type: "boolean", description: "Detected parking page or for-sale page — lower conflict risk than live business" },
    redirects_to: { type: ["string", "null"], description: "If the .com redirects to a different domain — may indicate brand ownership transfer" },
    error:        { type: ["string", "null"] },
  },
  required: ["checked_url", "live", "status_code", "title", "description", "parked", "redirects_to", "error"],
};

const FULL_REPORT_SCHEMA = {
  type: "object",
  description: "Complete brand clearance report",
  properties: {
    brand_name:          { type: "string" },
    normalized_name:     { type: "string", description: "Normalized form used for comparison (lowercase, legal suffixes stripped)" },
    conflict_risk_score: { type: "string", enum: ["HIGH", "MEDIUM", "LOW", "CLEAR"], description: "Overall clearance verdict. HIGH = stop. MEDIUM = attorney review. LOW = monitor. CLEAR = proceed." },
    conflict_summary:    { type: "string", description: "One-sentence human-readable verdict with key facts" },
    trademark_hits: {
      type: "array",
      description: "USPTO and EUIPO trademark matches, sorted by similarity score descending",
      items: TRADEMARK_HIT_SCHEMA,
    },
    domain_status: {
      type: "object",
      properties: {
        checked_domains: { type: "array", items: DOMAIN_REGISTRATION_SCHEMA },
        available_tlds:  { type: "array", items: { type: "string" }, description: "TLDs where the brand name is currently available" },
        registered_tlds: { type: "array", items: { type: "string" }, description: "TLDs where the brand name is already taken" },
        error:           { type: ["string", "null"] },
      },
      required: ["checked_domains", "available_tlds", "registered_tlds", "error"],
    },
    brand_web_metadata: BRAND_WEB_METADATA_SCHEMA,
    typosquat_domains: {
      type: "array",
      description: "Registered typosquat and variant domains (only registered ones returned — these are the risk)",
      items: TYPOSQUAT_SCHEMA,
    },
    company_registrations: {
      type: "array",
      description: "Similar company names found in Companies House (UK) and OpenCorporates (global)",
      items: COMPANY_REGISTRATION_SCHEMA,
    },
    risk_factors: {
      type: "array",
      description: "Specific risk factors driving the conflict_risk_score",
      items: RISK_FACTOR_SCHEMA,
    },
    data_freshness: { type: "string", format: "date-time" },
    latency_ms:     { type: "number" },
  },
  required: ["brand_name", "normalized_name", "conflict_risk_score", "conflict_summary", "trademark_hits", "domain_status", "brand_web_metadata", "typosquat_domains", "company_registrations", "risk_factors", "data_freshness", "latency_ms"],
};

// ── Tool definitions ───────────────────────────────────────────────────────

export const TOOLS = [
  {
    name: "check_brand_clearance",
    description: [
      "Full pre-launch brand conflict clearance in one call.",
      "Returns a unified conflict_risk_score (HIGH / MEDIUM / LOW / CLEAR) with supporting evidence across:",
      "USPTO trademark registry (US), EUIPO trademark registry (EU),",
      "domain availability across 7 TLDs (.com .net .org .io .co .app .ai),",
      "typosquat domain exposure (transpositions, omissions, keyword variants — checked via RDAP),",
      "and company registrations via Companies House (UK) and OpenCorporates (global).",
      "Similarity scoring uses Levenshtein distance with legal-suffix stripping.",
      "Replaces Trademarkia ($199/search) and LegalZoom Brand Protection ($299–$750/clearance).",
      "Not legal advice — factual clearance data to inform attorney review.",
    ].join(" "),
    examples: [
      { input: { brand_name: "Acme AI" } },
      { input: { brand_name: "Luminary" } },
    ],
    _meta: {
      surface: "both",
      queryEligible: true,
      latencyClass: "slow",
      pricing: { executeUsd: "0.0015" },
      rateLimit: {
        maxRequestsPerMinute: 20,
        cooldownMs: 3000,
        maxConcurrency: 3,
        notes: "Cold fetches hit USPTO, EUIPO, RDAP (7 TLDs + up to 20 typosquat checks), and OpenCorporates in parallel. 10–20s cold, sub-200ms warm (24h cache).",
      },
    },
    inputSchema: {
      type: "object",
      properties: {
        brand_name: {
          type: "string",
          description: "Brand name to clear. Accepts any casing, legal suffixes (Inc, LLC) are stripped for comparison.",
          default: "Luminary",
          examples: ["Acme AI", "Luminary", "Clearpath", "NovaSpark", "Tidewake"],
        },
      },
      required: ["brand_name"],
    },
    outputSchema: FULL_REPORT_SCHEMA,
  },

  {
    name: "search_trademarks",
    description: [
      "Search USPTO (US) and/or EUIPO (EU) trademark registries for conflicts with a brand name.",
      "Returns trademark hits with similarity scores, conflict levels, owner, goods class, and filing dates.",
      "Use jurisdiction='us' for US-only, 'eu' for EU-only, 'both' for cross-jurisdictional clearance.",
      "Results sorted by similarity score — EXACT and HIGH conflict level hits are the critical ones.",
      "Faster than check_brand_clearance when you only need trademark data.",
    ].join(" "),
    examples: [
      { input: { brand_name: "Luminary", jurisdiction: "both" } },
      { input: { brand_name: "Clearpath", jurisdiction: "us" } },
    ],
    _meta: {
      surface: "both",
      queryEligible: true,
      latencyClass: "fast",
      pricing: { executeUsd: "0.0010" },
      rateLimit: {
        maxRequestsPerMinute: 30,
        cooldownMs: 2000,
        maxConcurrency: 5,
      },
    },
    inputSchema: {
      type: "object",
      properties: {
        brand_name: {
          type: "string",
          description: "Brand name to search",
          default: "Luminary",
        },
        jurisdiction: {
          type: "string",
          enum: ["us", "eu", "both"],
          description: "Which trademark registry to search",
          default: "both",
        },
      },
      required: ["brand_name"],
    },
    outputSchema: {
      type: "object",
      properties: {
        brand_name:     { type: "string" },
        trademark_hits: { type: "array", items: TRADEMARK_HIT_SCHEMA },
        data_freshness: { type: "string", format: "date-time" },
      },
      required: ["brand_name", "trademark_hits", "data_freshness"],
    },
  },

  {
    name: "check_domain_conflicts",
    description: [
      "Check domain availability across 7 TLDs and enumerate registered typosquat variants.",
      "TLDs checked: .com .net .org .io .co .app .ai",
      "Typosquat check generates character transpositions, omissions, doublings, homoglyphs, and keyword variants (getbrand.com, brandhq.com, etc.) then verifies registration via RDAP.",
      "Returns only registered variants — those are the actual risk.",
      "Useful for: pre-launch domain strategy, competitive squatting monitoring, brand protection audits.",
    ].join(" "),
    examples: [
      { input: { brand_name: "Clearpath" } },
      { input: { brand_name: "NovaSpark" } },
    ],
    _meta: {
      surface: "both",
      queryEligible: true,
      latencyClass: "slow",
      pricing: { executeUsd: "0.0010" },
      rateLimit: {
        maxRequestsPerMinute: 20,
        cooldownMs: 3000,
        maxConcurrency: 3,
        notes: "Makes up to 27 parallel RDAP calls (7 TLDs + 20 typosquat candidates). 8–15s cold, sub-200ms warm.",
      },
    },
    inputSchema: {
      type: "object",
      properties: {
        brand_name: {
          type: "string",
          description: "Brand name to check",
          default: "Clearpath",
        },
      },
      required: ["brand_name"],
    },
    outputSchema: {
      type: "object",
      properties: {
        brand_name:        { type: "string" },
        domain_status: {
          type: "object",
          properties: {
            checked_domains: { type: "array", items: DOMAIN_REGISTRATION_SCHEMA },
            available_tlds:  { type: "array", items: { type: "string" } },
            registered_tlds: { type: "array", items: { type: "string" } },
            error:           { type: ["string", "null"] },
          },
          required: ["checked_domains", "available_tlds", "registered_tlds", "error"],
        },
        typosquat_domains: { type: "array", items: TYPOSQUAT_SCHEMA },
        data_freshness:    { type: "string", format: "date-time" },
      },
      required: ["brand_name", "domain_status", "typosquat_domains", "data_freshness"],
    },
  },

  {
    name: "search_company_names",
    description: [
      "Search for existing company registrations that conflict with a brand name.",
      "Searches Companies House (UK — requires COMPANIES_HOUSE_API_KEY env var) and OpenCorporates (global, free tier).",
      "Returns matches sorted by similarity score with jurisdiction, company number, status, and incorporation date.",
      "Useful for: UK/global company name clearance before incorporation, competitive research, M&A due diligence.",
    ].join(" "),
    examples: [
      { input: { brand_name: "Tidewake" } },
      { input: { brand_name: "Clearpath" } },
    ],
    _meta: {
      surface: "both",
      queryEligible: true,
      latencyClass: "fast",
      pricing: { executeUsd: "0.0010" },
      rateLimit: {
        maxRequestsPerMinute: 30,
        cooldownMs: 2000,
        maxConcurrency: 5,
      },
    },
    inputSchema: {
      type: "object",
      properties: {
        brand_name: {
          type: "string",
          description: "Brand or company name to search",
          default: "Tidewake",
        },
      },
      required: ["brand_name"],
    },
    outputSchema: {
      type: "object",
      properties: {
        brand_name:            { type: "string" },
        company_registrations: { type: "array", items: COMPANY_REGISTRATION_SCHEMA },
        data_freshness:        { type: "string", format: "date-time" },
      },
      required: ["brand_name", "company_registrations", "data_freshness"],
    },
  },
];
