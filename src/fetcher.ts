import type { BrandClearanceReport, TrademarkHit } from "./types.js";
import { Cache } from "./cache.js";
import { normalizeBrandName, computeOverallRisk } from "./similarity.js";
import { searchUsptoTrademarks } from "./uspto.js";
import { searchEuipoTrademarks } from "./euipo.js";
import { checkDomainAvailability, checkTyposquats } from "./domains.js";
import { searchCompanyRegistrations } from "./companies.js";
import { fetchBrandWebMetadata } from "./webcheck.js";

const TTL_MS = 24 * 60 * 60 * 1000; // 24h — trademark data stable intraday

const cache = new Cache<BrandClearanceReport>();

// ── Name normalization ────────────────────────────────────────────────────

export function sanitizeBrandName(raw: string): string {
  return raw.trim().slice(0, 100); // cap length, preserve original case for display
}

// ── Main clearance fetch ──────────────────────────────────────────────────

export async function runBrandClearance(rawName: string, niceClass?: number): Promise<BrandClearanceReport> {
  const brand    = sanitizeBrandName(rawName);
  const baseKey  = normalizeBrandName(brand);

  if (!baseKey || baseKey.length < 2) throw new Error(`Brand name too short or invalid: "${rawName}"`);

  // Include nice_class in cache key so different class queries don't share cached results
  const cacheKey = niceClass !== undefined ? `${baseKey}:nc${niceClass}` : baseKey;

  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const t0 = Date.now();

  // All 6 data sources fire in parallel
  const [usptoResult, euipoResult, domainResult, typosquatResult, companyResult, webMetadata] =
    await Promise.all([
      searchUsptoTrademarks(brand, 20),
      searchEuipoTrademarks(brand, 20),
      checkDomainAvailability(brand),
      checkTyposquats(brand),
      searchCompanyRegistrations(brand, 10),
      fetchBrandWebMetadata(brand),
    ]);

  const allTrademarkHits: TrademarkHit[] = [
    ...usptoResult.hits,
    ...euipoResult.hits,
  ].sort((a, b) => b.similarity_score - a.similarity_score);

  const { score, factors, summary } = computeOverallRisk(
    allTrademarkHits,
    domainResult.checked_domains,
    typosquatResult,
    companyResult.registrations,
    niceClass,
  );

  const report: BrandClearanceReport = {
    brand_name:             brand,
    normalized_name:        baseKey,
    conflict_risk_score:    score,
    conflict_summary:       summary,
    trademark_hits:         allTrademarkHits,
    domain_status:          domainResult,
    brand_web_metadata:     webMetadata,
    typosquat_domains:      typosquatResult,
    company_registrations:  companyResult.registrations,
    risk_factors:           factors,
    data_freshness:         new Date().toISOString(),
    latency_ms:             Date.now() - t0,
  };

  cache.set(cacheKey, report, TTL_MS);
  return report;
}

// ── Sub-fetchers (share cache, focused output) ────────────────────────────

export async function getTrademarkHits(rawName: string) {
  const report = await runBrandClearance(rawName);
  return {
    brand_name:      report.brand_name,
    trademark_hits:  report.trademark_hits,
    data_freshness:  report.data_freshness,
  };
}

export async function getDomainConflicts(rawName: string) {
  const report = await runBrandClearance(rawName);
  return {
    brand_name:       report.brand_name,
    domain_status:    report.domain_status,
    typosquat_domains:report.typosquat_domains,
    data_freshness:   report.data_freshness,
  };
}

export async function getCompanyConflicts(rawName: string) {
  const report = await runBrandClearance(rawName);
  return {
    brand_name:            report.brand_name,
    company_registrations: report.company_registrations,
    data_freshness:        report.data_freshness,
  };
}

export function getCacheSize(): number {
  return cache.size();
}
