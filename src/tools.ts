// ── Shared sub-schemas ─────────────────────────────────────────────────────

const TRADEMARK_HIT_SCHEMA = {
  type: "object",
  properties: {
    source:              { type: "string", enum: ["USPTO", "EUIPO"] },
    mark_name:           { type: "string" },
    similarity_score:    { type: "number", description: "Levenshtein similarity (0–100). 100 = exact match." },
    conflict_level:      { type: "string", enum: ["EXACT", "HIGH", "MEDIUM", "LOW"], description: "EXACT=100%, HIGH≥85%, MEDIUM≥70%, LOW<70%." },
    status:              { type: "string", enum: ["LIVE", "DEAD", "PENDING", "REGISTERED", "UNKNOWN"] },
    goods_class:         { type: ["string", "null"], description: "Nice class number(s), e.g. '009, 042'." },
    goods_description:   { type: ["string", "null"] },
    owner:               { type: ["string", "null"] },
    serial_number:       { type: ["string", "null"] },
    registration_number: { type: ["string", "null"] },
    filed_date:          { type: ["string", "null"] },
    registration_date:   { type: ["string", "null"] },
    jurisdiction:        { type: "string", description: "'US' or 'EU'" },
  },
  required: ["source","mark_name","similarity_score","conflict_level","status","goods_class","goods_description","owner","serial_number","registration_number","filed_date","registration_date","jurisdiction"],
};

const DOMAIN_REGISTRATION_SCHEMA = {
  type: "object",
  properties: {
    domain:            { type: "string" },
    tld:               { type: "string" },
    registered:        { type: ["boolean", "null"], description: "true=registered, false=available, null=RDAP check failed — do not interpret null as available" },
    registrar:         { type: ["string", "null"] },
    registered_at:     { type: ["string", "null"] },
    expires_at:        { type: ["string", "null"] },
    privacy_protected: { type: "boolean" },
  },
  required: ["domain","tld","registered","registrar","registered_at","expires_at","privacy_protected"],
};

const TYPOSQUAT_SCHEMA = {
  type: "object",
  properties: {
    domain:           { type: "string" },
    permutation_type: { type: "string", enum: ["tld_variation","typo_transposition","typo_omission","typo_doubling","keyword_prefix","keyword_suffix","homoglyph"] },
    registered:       { type: "boolean" },
    registrar:        { type: ["string", "null"] },
    risk_note:        { type: "string" },
  },
  required: ["domain","permutation_type","registered","registrar","risk_note"],
};

const COMPANY_REGISTRATION_SCHEMA = {
  type: "object",
  properties: {
    source:           { type: "string", enum: ["companies_house", "gleif"], description: "companies_house = UK Companies House; gleif = GLEIF global entity registry (2.5M+ entities, global LEI standard)" },
    name:             { type: "string" },
    similarity_score: { type: "number" },
    jurisdiction:     { type: "string", description: "ISO 3166-1 alpha-2 country code (e.g. 'US', 'GB', 'DE') or LEI jurisdiction code" },
    company_number:   { type: ["string", "null"], description: "Company number (Companies House) or 20-character LEI code (GLEIF)" },
    status:           { type: ["string", "null"] },
    incorporated_on:  { type: ["string", "null"] },
    company_type:     { type: ["string", "null"] },
  },
  required: ["source","name","similarity_score","jurisdiction","company_number","status","incorporated_on","company_type"],
};

const RISK_FACTOR_SCHEMA = {
  type: "object",
  properties: {
    type:        { type: "string", enum: ["trademark_conflict","domain_taken","company_name_conflict","typosquat_exposure"] },
    severity:    { type: "string", enum: ["HIGH","MEDIUM","LOW","CLEAR"] },
    description: { type: "string" },
    source:      { type: "string" },
  },
  required: ["type","severity","description","source"],
};

const BRAND_WEB_METADATA_SCHEMA = {
  type: "object",
  properties: {
    checked_url:  { type: ["string", "null"] },
    live:         { type: "boolean", description: "HTTP 200/redirect to active site" },
    status_code:  { type: ["number", "null"] },
    title:        { type: ["string", "null"] },
    description:  { type: ["string", "null"] },
    parked:       { type: "boolean", description: "Detected parking/for-sale page — lower conflict signal than live business" },
    redirects_to: { type: ["string", "null"] },
    error:        { type: ["string", "null"] },
  },
  required: ["checked_url","live","status_code","title","description","parked","redirects_to","error"],
};

const FULL_REPORT_SCHEMA = {
  type: "object",
  properties: {
    brand_name:          { type: "string" },
    normalized_name:     { type: "string" },
    conflict_risk_score: { type: "string", enum: ["HIGH","MEDIUM","LOW","CLEAR"], description: "HIGH = stop. MEDIUM = attorney review. LOW = monitor. CLEAR = proceed." },
    conflict_summary:    { type: "string" },
    trademark_hits:      { type: "array", items: TRADEMARK_HIT_SCHEMA },
    domain_status: {
      type: "object",
      properties: {
        checked_domains: { type: "array", items: DOMAIN_REGISTRATION_SCHEMA },
        available_tlds:  { type: "array", items: { type: "string" } },
        registered_tlds: { type: "array", items: { type: "string" } },
        error:           { type: ["string", "null"] },
      },
      required: ["checked_domains","available_tlds","registered_tlds","error"],
    },
    brand_web_metadata:    BRAND_WEB_METADATA_SCHEMA,
    typosquat_domains:     { type: "array", items: TYPOSQUAT_SCHEMA },
    company_registrations: { type: "array", items: COMPANY_REGISTRATION_SCHEMA },
    risk_factors:          { type: "array", items: RISK_FACTOR_SCHEMA },
    data_freshness:        { type: "string", format: "date-time" },
    latency_ms:            { type: "number" },
    trademark_total:       { type: "number", description: "Total trademark hits found across all statuses. Active (LIVE/REGISTERED/PENDING) hits are returned in trademark_hits; use search_trademarks for full history including dead marks." },
    trademark_active:      { type: "number", description: "Number of active (LIVE/REGISTERED/PENDING) trademark hits found." },
  },
  required: ["brand_name","normalized_name","conflict_risk_score","conflict_summary","trademark_hits","domain_status","brand_web_metadata","typosquat_domains","company_registrations","risk_factors","data_freshness","latency_ms"],
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
      "company name conflicts via GLEIF global entity registry (2.5M+ active legal entities, global LEI standard, no key required)",
      "and UK Companies House if COMPANIES_HOUSE_API_KEY is set.",
      "Similarity scoring uses Levenshtein distance with legal-suffix stripping and Unicode normalization.",
      "Optional nice_class (Nice classification number, e.g. 42) re-weights trademark hits:",
      "hits in a different goods/services class are downgraded one conflict level.",
      "Returns lean response by default: only LIVE/REGISTERED/PENDING marks (up to 10), descriptions capped at 150 chars, top 5 companies, top 10 typosquats.",
      "trademark_total and trademark_active show full counts. Use search_trademarks for complete history.",
      "Replaces Trademarkia ($199/search) and LegalZoom Brand Protection ($299–$750/clearance).",
      "Not legal advice — factual clearance data to inform attorney review.",
    ].join(" "),
    examples: [
      { input: { brand_name: "Acme AI" } },
      { input: { brand_name: "Luminary", nice_class: 42 } },
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
        notes: "Cold fetches hit USPTO, EUIPO, RDAP (7 TLDs + up to 20 typosquat checks), GLEIF, and Companies House in parallel. 10–20s cold, sub-200ms warm (24h cache).",
      },
    },
    inputSchema: {
      type: "object",
      properties: {
        brand_name: {
          type: "string",
          description: "Brand name to clear. Any casing; legal suffixes (Inc, LLC) stripped for comparison.",
          default: "Luminary",
          examples: ["Acme AI","Luminary","Clearpath","NovaSpark","Tidewake"],
        },
        nice_class: {
          type: "number",
          description: "Optional Nice classification number (1–45) for your goods/services. When provided, trademark hits in a different class are downgraded one conflict level. E.g. 9 (software), 35 (advertising), 42 (SaaS/tech services).",
          minimum: 1,
          maximum: 45,
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
      "Optional nice_class re-weights hits in different goods/services classes.",
      "Results sorted by similarity score descending.",
    ].join(" "),
    examples: [
      { input: { brand_name: "Luminary", jurisdiction: "both" } },
      { input: { brand_name: "Clearpath", jurisdiction: "us", nice_class: 42 } },
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
        nice_class: {
          type: "number",
          description: "Optional Nice class (1–45). Hits in a different class are downgraded one conflict level.",
          minimum: 1,
          maximum: 45,
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
      required: ["brand_name","trademark_hits","data_freshness"],
    },
  },

  {
    name: "check_domain_conflicts",
    description: [
      "Check domain availability across 7 TLDs and enumerate registered typosquat variants.",
      "TLDs checked: .com .net .org .io .co .app .ai",
      "Typosquat check generates character transpositions, omissions, doublings, homoglyphs, and keyword variants (getbrand.com, brandhq.com, etc.) then verifies registration via RDAP.",
      "Returns only registered variants — those are the actual risk.",
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
        brand_name: { type: "string", description: "Brand name to check", default: "Clearpath" },
      },
      required: ["brand_name"],
    },
    outputSchema: {
      type: "object",
      properties: {
        brand_name: { type: "string" },
        domain_status: {
          type: "object",
          properties: {
            checked_domains: { type: "array", items: DOMAIN_REGISTRATION_SCHEMA },
            available_tlds:  { type: "array", items: { type: "string" } },
            registered_tlds: { type: "array", items: { type: "string" } },
            error:           { type: ["string", "null"] },
          },
          required: ["checked_domains","available_tlds","registered_tlds","error"],
        },
        typosquat_domains: { type: "array", items: TYPOSQUAT_SCHEMA },
        data_freshness:    { type: "string", format: "date-time" },
      },
      required: ["brand_name","domain_status","typosquat_domains","data_freshness"],
    },
  },

  {
    name: "search_company_names",
    description: [
      "Search for existing company registrations that conflict with a brand name.",
      "Sources: GLEIF global entity registry (2.5M+ active legal entities, G20-endorsed LEI standard, free, no key required — covers US, EU, and global regulated entities)",
      "and UK Companies House (COMPANIES_HOUSE_API_KEY required, free key at developer.company-information.service.gov.uk).",
      "Returns matches sorted by similarity score with jurisdiction, company number or LEI, status, and incorporation date.",
      "Coverage note: GLEIF covers entities required to hold a Legal Entity Identifier — strong coverage for US and EU financial/corporate entities.",
      "Private LLCs incorporated only at the state level without an LEI are outside GLEIF scope.",
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
        brand_name: { type: "string", description: "Brand or company name to search", default: "Tidewake" },
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
      required: ["brand_name","company_registrations","data_freshness"],
    },
  },
];
