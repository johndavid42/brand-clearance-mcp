// ── Risk levels ───────────────────────────────────────────────────────────

export type RiskLevel = "HIGH" | "MEDIUM" | "LOW" | "CLEAR";
export type ConflictLevel = "EXACT" | "HIGH" | "MEDIUM" | "LOW";
export type TrademarkStatus = "LIVE" | "DEAD" | "PENDING" | "REGISTERED" | "UNKNOWN";
export type TrademarkSource = "USPTO" | "EUIPO";
export type PermutationType =
  | "tld_variation"
  | "typo_transposition"
  | "typo_omission"
  | "typo_doubling"
  | "keyword_prefix"
  | "keyword_suffix"
  | "homoglyph";

// ── Top-level report ──────────────────────────────────────────────────────

export interface BrandClearanceReport {
  brand_name: string;
  normalized_name: string;
  conflict_risk_score: RiskLevel;
  conflict_summary: string;
  trademark_hits: TrademarkHit[];
  domain_status: DomainStatus;
  brand_web_metadata: BrandWebMetadata; // HTTP fetch of brand.com — live vs parked
  typosquat_domains: TyposquatDomain[];
  company_registrations: CompanyRegistration[];
  risk_factors: RiskFactor[];
  data_freshness: string;
  latency_ms: number;
}

// ── Trademark ─────────────────────────────────────────────────────────────

export interface TrademarkHit {
  source: TrademarkSource;
  mark_name: string;
  similarity_score: number;       // 0–100
  conflict_level: ConflictLevel;
  status: TrademarkStatus;
  goods_class: string | null;     // Nice class number(s), e.g. "9, 42"
  goods_description: string | null;
  owner: string | null;
  serial_number: string | null;
  registration_number: string | null;
  filed_date: string | null;
  registration_date: string | null;
  jurisdiction: string;           // "US" or "EU"
}

export interface TrademarkSearchResult {
  hits: TrademarkHit[];
  source: TrademarkSource;
  total_found: number;
  error: string | null;
}

// ── Domain ────────────────────────────────────────────────────────────────

export interface DomainStatus {
  checked_domains: DomainRegistration[];
  available_tlds: string[];
  registered_tlds: string[];
  error: string | null;
}

export interface DomainRegistration {
  domain: string;
  tld: string;
  registered: boolean;
  registrar: string | null;
  registered_at: string | null;
  expires_at: string | null;
  privacy_protected: boolean;
}

export interface TyposquatDomain {
  domain: string;
  permutation_type: PermutationType;
  registered: boolean;
  registrar: string | null;
  risk_note: string;              // why this permutation matters
}

// ── Company registrations ─────────────────────────────────────────────────

export interface CompanyRegistration {
  source: "companies_house" | "gleif";
  name: string;
  similarity_score: number;       // 0–100
  jurisdiction: string;
  company_number: string | null;
  status: string | null;
  incorporated_on: string | null;
  company_type: string | null;
}

export interface CompanySearchResult {
  registrations: CompanyRegistration[];
  error: string | null;
}

// ── Brand web metadata ────────────────────────────────────────────────────

export interface BrandWebMetadata {
  checked_url: string | null;     // e.g. "https://luminary.com"
  live: boolean;                  // HTTP 200 or redirect to active site
  status_code: number | null;
  title: string | null;           // <title> tag — reveals if it's a live business
  description: string | null;     // <meta description>
  parked: boolean;                // Detected parking page / for-sale page
  redirects_to: string | null;    // If the .com redirects to a different domain
  error: string | null;
}

// ── Risk factors ──────────────────────────────────────────────────────────

export interface RiskFactor {
  type: "trademark_conflict" | "domain_taken" | "company_name_conflict" | "typosquat_exposure";
  severity: RiskLevel;
  description: string;
  source: string;
}

// ── RDAP response (reused from domain-intel) ──────────────────────────────

export interface RdapDomainResult {
  registered: boolean;
  registrar: string | null;
  registered_at: string | null;
  expires_at: string | null;
  privacy_protected: boolean;
  error: string | null;
}
