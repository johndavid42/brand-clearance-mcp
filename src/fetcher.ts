import type { BrandClearanceReport, TrademarkHit } from "./types.js";
import { Cache } from "./cache.js";
import { normalizeBrandName, computeOverallRisk, applyNiceClassFilter } from "./similarity.js";
import { searchUsptoTrademarks } from "./uspto.js";
import { searchEuipoTrademarks } from "./euipo.js";
import { checkDomainAvailability, checkTyposquats } from "./domains.js";
import { searchCompanyRegistrations } from "./companies.js";
import { fetchBrandWebMetadata } from "./webcheck.js";

const TTL_MS = 24 * 60 * 60 * 1000; // 24h

const cache = new Cache<BrandClearanceReport>();

// ── Name normalization ────────────────────────────────────────────────────

export function sanitizeBrandName(raw: string): string {
  return raw.trim().slice(0, 100);
}

// ── nice_class post-processing ────────────────────────────────────────────
// nice_class re-weighting is pure post-processing — it never triggers a new
// fetch. We always cache the raw (unweighted) report and apply the class
// filter at query time. This prevents one unique class value per call from
// exhausting USPTO rate limits with duplicate fetches.

function applyNiceClass(report: BrandClearanceReport, niceClass: number): BrandClearanceReport {
  const effectiveHits = applyNiceClassFilter(report.trademark_hits, niceClass);
  const { score, factors, summary } = computeOverallRisk(
    effectiveHits,
    report.domain_status.checked_domains,
    report.typosquat_domains,
    report.company_registrations,
  );
  return {
    ...report,
    trademark_hits:      effectiveHits,
    conflict_risk_score: score,
    conflict_summary:    summary,
    risk_factors:        factors,
  };
}

// ── Main clearance fetch ──────────────────────────────────────────────────

export async function runBrandClearance(rawName: string, niceClass?: number): Promise<BrandClearanceReport> {
  const brand   = sanitizeBrandName(rawName);
  const baseKey = normalizeBrandName(brand);

  if (!baseKey || baseKey.length < 2) throw new Error(`Brand name too short or invalid: "${rawName}"`);

  // Always cache by brand name only — nice_class is applied on the way out
  const cached = cache.get(baseKey);
  if (cached) {
    return niceClass !== undefined ? applyNiceClass(cached, niceClass) : cached;
  }

  const t0 = Date.now();
  const mark = (label: string) => {
    const ms = Date.now() - t0;
    console.log(`[clearance:timing] ${label.padEnd(12)} ${ms}ms | brand="${brand}"`);
    return ms;
  };

  // All 6 data sources fire in parallel — log when each completes
  const [usptoResult, euipoResult, domainResult, typosquatResult, companyResult, webMetadata] =
    await Promise.all([
      searchUsptoTrademarks(brand, 20).then(r  => { mark("uspto");      return r; }),
      searchEuipoTrademarks(brand, 20).then(r  => { mark("euipo");      return r; }),
      checkDomainAvailability(brand).then(r    => { mark("domains");    return r; }),
      checkTyposquats(brand).then(r            => { mark("typosquats"); return r; }),
      searchCompanyRegistrations(brand, 10).then(r => { mark("companies"); return r; }),
      fetchBrandWebMetadata(brand).then(r      => { mark("webmeta");    return r; }),
    ]);

  const rawTrademarkHits: TrademarkHit[] = [
    ...usptoResult.hits,
    ...euipoResult.hits,
  ].sort((a, b) => b.similarity_score - a.similarity_score);

  // Compute risk on raw hits for storage
  const { score, factors, summary } = computeOverallRisk(
    rawTrademarkHits,
    domainResult.checked_domains,
    typosquatResult,
    companyResult.registrations,
  );

  const report: BrandClearanceReport = {
    brand_name:             brand,
    normalized_name:        baseKey,
    conflict_risk_score:    score,
    conflict_summary:       summary,
    trademark_hits:         rawTrademarkHits,  // always store raw, unweighted
    domain_status:          domainResult,
    brand_web_metadata:     webMetadata,
    typosquat_domains:      typosquatResult,
    company_registrations:  companyResult.registrations,
    risk_factors:           factors,
    data_freshness:         new Date().toISOString(),
    latency_ms:             Date.now() - t0,
  };

  cache.set(baseKey, report, TTL_MS);

  const totalMs    = Date.now() - t0;
  const payloadB   = JSON.stringify(report).length;
  const tmHits     = rawTrademarkHits.length;
  console.log(`[clearance:done] total=${totalMs}ms | payload=${payloadB}B (${(payloadB/1024).toFixed(1)}KB) | trademark_hits=${tmHits} | brand="${brand}"`);

  // Apply nice_class on the way out without mutating the cached version
  return niceClass !== undefined ? applyNiceClass(report, niceClass) : report;
}

// ── Sub-fetchers (share cache, focused output) ────────────────────────────

export async function getTrademarkHits(rawName: string, niceClass?: number) {
  const report = await runBrandClearance(rawName, niceClass);
  return {
    brand_name:      report.brand_name,
    trademark_hits:  report.trademark_hits,
    data_freshness:  report.data_freshness,
  };
}

export async function getDomainConflicts(rawName: string) {
  const report = await runBrandClearance(rawName);
  return {
    brand_name:        report.brand_name,
    domain_status:     report.domain_status,
    typosquat_domains: report.typosquat_domains,
    data_freshness:    report.data_freshness,
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
