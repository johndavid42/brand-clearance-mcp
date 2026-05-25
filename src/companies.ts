import type { CompanyRegistration, CompanySearchResult } from "./types.js";
import { similarityScore } from "./similarity.js";
import { ENV } from "./env.js";
import { searchGleifCompanies } from "./gleif.js";

// ── Companies House (UK) ──────────────────────────────────────────────────
// Free API key: https://developer.company-information.service.gov.uk/
// Covers all UK-registered companies. Set COMPANIES_HOUSE_API_KEY env var.
// GLEIF handles global + US coverage (no key required).

interface ChCompany {
  title?: string;
  company_number?: string;
  company_status?: string;
  company_type?: string;
  date_of_creation?: string;
}

interface ChResponse {
  items?: ChCompany[];
  total_results?: number;
}

async function searchCompaniesHouseInternal(name: string, rows = 10): Promise<CompanySearchResult> {
  const url = `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(name)}&items_per_page=${rows}`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      headers: {
        Authorization: `Basic ${Buffer.from(`${ENV.COMPANIES_HOUSE_API_KEY}:`).toString("base64")}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) throw new Error(`Companies House HTTP ${res.status}`);
    const data = await res.json() as ChResponse;

    const registrations: CompanyRegistration[] = (data.items ?? [])
      .map(c => ({
        source:          "companies_house" as const,
        name:            c.title ?? "",
        similarity_score: similarityScore(name, c.title ?? ""),
        jurisdiction:    "GB",
        company_number:  c.company_number ?? null,
        status:          c.company_status ?? null,
        incorporated_on: c.date_of_creation ?? null,
        company_type:    c.company_type ?? null,
      }))
      .filter(c => c.similarity_score >= 50 && c.name.trim())
      .sort((a, b) => b.similarity_score - a.similarity_score)
      .slice(0, rows);

    return { registrations, error: null };
  } catch (err) {
    return {
      registrations: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Public API ────────────────────────────────────────────────────────────
// Runs GLEIF (global + US, always) and Companies House (UK, if key set) in parallel.

export async function searchCompanyRegistrations(
  brandName: string,
  rows = 10,
): Promise<CompanySearchResult> {
  const tasks: Promise<CompanySearchResult>[] = [
    searchGleifCompanies(brandName, rows),
  ];

  if (ENV.COMPANIES_HOUSE_API_KEY) {
    tasks.push(searchCompaniesHouseInternal(brandName, rows));
  }

  const results = await Promise.all(tasks);

  // Merge, deduplicate by source+name
  const seen = new Set<string>();
  const merged: CompanyRegistration[] = [];

  for (const result of results) {
    for (const r of result.registrations) {
      const key = `${r.source}:${r.name.toLowerCase().trim()}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(r);
      }
    }
  }

  merged.sort((a, b) => b.similarity_score - a.similarity_score);

  // Only surface an error if every source failed and we have no results
  const errors = results.map(r => r.error).filter(Boolean) as string[];
  const allFailed = merged.length === 0 && errors.length === tasks.length;

  return {
    registrations: merged.slice(0, rows),
    error: allFailed ? errors.join("; ") : null,
  };
}
