// ── GLEIF — Global Legal Entity Identifier Foundation ────────────────────
// Official API: https://api.gleif.org/api/v1
// Free, no API key, no rate limit stated. 2.5M+ active legal entities worldwide.
// Endorsed by G20 and mandated for regulated financial entities globally.
// Covers US entities (LEI required for any securities market participation),
// EU entities, and global corporate groups.
// Replaces OpenCorporates (paid enterprise only) as the global company search source.

import type { CompanyRegistration, CompanySearchResult } from "./types.js";
import { similarityScore, normalizeBrandName } from "./similarity.js";

const GLEIF_BASE = "https://api.gleif.org/api/v1";

// ── Response types (from GLEIF JSON:API spec) ─────────────────────────────

interface GleifLegalName {
  name: string;
  language?: string;
}

interface GleifAddress {
  country?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  addressLines?: string[];
}

interface GleifLegalForm {
  id?: string;
  other?: string;
}

interface GleifEntity {
  legalName: GleifLegalName;
  status: "ACTIVE" | "INACTIVE" | "PENDING_ARCHIVAL";
  legalAddress?: GleifAddress;
  jurisdiction?: string;  // e.g. "US-DE", "GB"
  legalForm?: GleifLegalForm;
  entityCategory?: "GENERAL" | "FUND" | "BRANCH" | "SOLE_PROPRIETOR";
}

interface GleifRegistration {
  initialRegistrationDate?: string;
  lastUpdateDate?: string;
  status?: "ISSUED" | "LAPSED" | "MERGED" | "RETIRED" | "ANNULLED" | "DUPLICATE" | "TRANSFERRED" | "PENDING_TRANSFER" | "PENDING_ARCHIVAL";
}

interface GleifRecord {
  id: string;  // 20-character LEI code
  type: "lei-records";
  attributes: {
    entity: GleifEntity;
    registration: GleifRegistration;
  };
}

interface GleifResponse {
  data: GleifRecord[];
  meta: {
    pagination: {
      total: number;
      currentPage: number;
      perPage: number;
    };
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────

function parseJurisdiction(entity: GleifEntity): string {
  // Prefer legalAddress.country — it's a 2-letter ISO code
  const country = entity.legalAddress?.country;
  if (country) return country;
  // Fall back to jurisdiction field (may be "US-DE", "GB", etc.)
  const jur = entity.jurisdiction;
  if (jur) return jur.includes("-") ? jur.split("-")[0] : jur;
  return "UNKNOWN";
}

function parseStatus(entity: GleifEntity, reg: GleifRegistration): string {
  if (entity.status === "ACTIVE" && reg.status === "ISSUED") return "active";
  if (entity.status === "INACTIVE") return "inactive";
  return (reg.status ?? entity.status ?? "UNKNOWN").toLowerCase();
}

function parseCompanyType(entity: GleifEntity): string | null {
  // Prefer legalForm.id (ISO standard code), fall back to entityCategory
  return entity.legalForm?.id ?? entity.entityCategory ?? null;
}

// ── Public API ────────────────────────────────────────────────────────────

export async function searchGleifCompanies(
  brandName: string,
  rows = 20,
): Promise<CompanySearchResult> {
  try {
    // Fetch up to 50 results — GLEIF returns exact-name matches first.
    // We filter by similarity post-fetch so cast a wide net.
    const params = new URLSearchParams({
      "filter[entity.legalName]": brandName,
      "filter[entity.status]": "ACTIVE",
      "page[size]": "50",
      "page[number]": "1",
    });

    const res = await fetch(`${GLEIF_BASE}/lei-records?${params}`, {
      headers: {
        Accept: "application/vnd.api+json",
        "User-Agent": "BrandClearanceMCP/1.0",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 429) throw new Error("GLEIF rate limit — retry later");
    if (!res.ok)           throw new Error(`GLEIF HTTP ${res.status}`);

    const data = await res.json() as GleifResponse;

    const registrations: CompanyRegistration[] = (data.data ?? [])
      .map((record): CompanyRegistration => {
        const entity = record.attributes.entity;
        const reg    = record.attributes.registration;
        const name   = entity.legalName.name;

        let score = similarityScore(brandName, name);

        // Prefix boost: "Luminary Real Estate LLC" → normalizes to "luminaryrealestate"
        // which starts with "luminary". Pure Levenshtein penalizes the extra words too
        // harshly (score ~39), but this is unambiguously a brand conflict.
        // Boost any company whose normalized name starts with the normalized brand to 75.
        const nb = normalizeBrandName(brandName);
        const nc = normalizeBrandName(name);
        if (nb.length >= 4 && nc.startsWith(nb) && score < 75) score = 75;

        return {
          source:          "gleif",
          name,
          similarity_score: score,
          jurisdiction:    parseJurisdiction(entity),
          company_number:  record.id,
          status:          parseStatus(entity, reg),
          incorporated_on: reg.initialRegistrationDate ?? null,
          company_type:    parseCompanyType(entity),
        };
      })
      .filter(r => r.similarity_score >= 50 && r.name.trim())
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
