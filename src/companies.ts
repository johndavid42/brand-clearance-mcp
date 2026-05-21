import type { CompanyRegistration, CompanySearchResult } from "./types.js";
import { similarityScore } from "./similarity.js";
import { ENV } from "./env.js";

// ── Companies House (UK) ──────────────────────────────────────────────────
// Free API key: https://developer.company-information.service.gov.uk/
// If COMPANIES_HOUSE_API_KEY env var is not set, this source is skipped.

interface ChCompany {
  title?: string;
  company_number?: string;
  company_status?: string;
  company_type?: string;
  date_of_creation?: string;
  registered_office_address?: {
    address_line_1?: string;
    locality?: string;
    postal_code?: string;
    country?: string;
  };
}

interface ChResponse {
  items?: ChCompany[];
  total_results?: number;
}

async function searchCompaniesHouse(name: string, rows = 10): Promise<CompanyRegistration[]> {
  if (!ENV.COMPANIES_HOUSE_API_KEY) return [];

  const url = `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(name)}&items_per_page=${rows}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(8_000),
    headers: {
      Authorization: `Basic ${Buffer.from(`${ENV.COMPANIES_HOUSE_API_KEY}:`).toString("base64")}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) throw new Error(`Companies House HTTP ${res.status}`);
  const data = await res.json() as ChResponse;

  return (data.items ?? []).map(c => ({
    source: "companies_house" as const,
    name: c.title ?? "",
    similarity_score: similarityScore(name, c.title ?? ""),
    jurisdiction: "GB",
    company_number: c.company_number ?? null,
    status: c.company_status ?? null,
    incorporated_on: c.date_of_creation ?? null,
    company_type: c.company_type ?? null,
  }));
}

// ── OpenCorporates ────────────────────────────────────────────────────────
// Free tier, no auth required for basic search.
// https://api.opencorporates.com/

interface OcCompany {
  name?: string;
  company_number?: string;
  jurisdiction_code?: string;
  current_status?: string;
  incorporation_date?: string;
  company_type?: string;
}

interface OcResponse {
  results?: {
    companies?: Array<{ company?: OcCompany }>;
  };
}

async function searchOpenCorporates(name: string, rows = 10): Promise<CompanyRegistration[]> {
  const url = `https://api.opencorporates.com/v0.4/companies/search?q=${encodeURIComponent(name)}&per_page=${rows}&format=json`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: "application/json" },
  });

  if (!res.ok) throw new Error(`OpenCorporates HTTP ${res.status}`);
  const data = await res.json() as OcResponse;

  const companies = data.results?.companies ?? [];
  return companies
    .map(item => item.company)
    .filter((c): c is OcCompany => !!c)
    .map(c => ({
      source: "opencorporates" as const,
      name: c.name ?? "",
      similarity_score: similarityScore(name, c.name ?? ""),
      jurisdiction: (c.jurisdiction_code ?? "").toUpperCase(),
      company_number: c.company_number ?? null,
      status: c.current_status ?? null,
      incorporated_on: c.incorporation_date ?? null,
      company_type: c.company_type ?? null,
    }));
}

// ── Public API ────────────────────────────────────────────────────────────

export async function searchCompanyRegistrations(
  brandName: string,
  rows = 10,
): Promise<CompanySearchResult> {
  try {
    const [chResults, ocResults] = await Promise.allSettled([
      searchCompaniesHouse(brandName, rows),
      searchOpenCorporates(brandName, rows),
    ]);

    const all: CompanyRegistration[] = [
      ...(chResults.status === "fulfilled" ? chResults.value : []),
      ...(ocResults.status === "fulfilled" ? ocResults.value : []),
    ];

    // Filter to meaningful similarity and deduplicate by (name, jurisdiction)
    const seen = new Set<string>();
    const filtered = all
      .filter(c => c.similarity_score >= 50 && c.name.trim())
      .sort((a, b) => b.similarity_score - a.similarity_score)
      .filter(c => {
        const key = `${c.name.toLowerCase()}:${c.jurisdiction}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, rows);

    const errors: string[] = [];
    if (chResults.status === "rejected")  errors.push(`Companies House: ${chResults.reason}`);
    if (ocResults.status === "rejected")  errors.push(`OpenCorporates: ${ocResults.reason}`);

    return {
      registrations: filtered,
      error: errors.length > 0 ? errors.join("; ") : null,
    };
  } catch (err) {
    return {
      registrations: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
