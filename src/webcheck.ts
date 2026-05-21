// ── Brand domain web metadata ──────────────────────────────────────────────
// If brand.com is registered, a quick HTTP fetch reveals whether it is:
//   - A live business site (active conflict signal)
//   - A parked / for-sale page (squatter, lower conflict signal)
//   - Redirecting to another domain (brand ownership context)
// This fills the "website metadata — direct HTTP fetch of brand domain" data
// source from the proposal without a full scrape.

import type { BrandWebMetadata } from "./types.js";

const PARKED_PATTERNS = [
  /this domain (is|has been) (for sale|parked|available)/i,
  /buy this domain/i,
  /domain for sale/i,
  /godaddy\.com/i,
  /sedoparking\.com/i,
  /dan\.com/i,
  /afternic\.com/i,
  /namecheap\.com/i,
  /hugedomains\.com/i,
  /underconstruction/i,
  /under construction/i,
  /coming soon/i,
  /parking page/i,
];

function isParkedPage(title: string | null, body: string): boolean {
  const text = `${title ?? ""} ${body.slice(0, 2000)}`;
  return PARKED_PATTERNS.some(p => p.test(text));
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
  return m ? m[1].trim() : null;
}

function extractDescription(html: string): string | null {
  const m =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,300})["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']{1,300})["'][^>]+name=["']description["']/i);
  return m ? m[1].trim() : null;
}

export async function fetchBrandWebMetadata(brandName: string): Promise<BrandWebMetadata> {
  const domain = brandName.toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!domain) return { checked_url: null, live: false, status_code: null, title: null, description: null, parked: false, redirects_to: null, error: "Invalid brand name for web check" };

  const url = `https://${domain}.com`;

  try {
    let finalUrl = url;
    let statusCode: number | null = null;
    let body = "";
    let redirectsTo: string | null = null;

    // Follow up to 3 redirects manually so we can detect cross-domain redirects
    let current = url;
    for (let i = 0; i <= 3; i++) {
      const res = await fetch(current, {
        signal: AbortSignal.timeout(8_000),
        redirect: "manual",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; BrandClearanceMCP/1.0)",
          Accept: "text/html,*/*",
        },
      });

      statusCode = res.status;

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) break;
        const next = loc.startsWith("http") ? loc : new URL(loc, current).href;
        // Cross-domain redirect — record it and stop
        if (!new URL(next).hostname.includes(`${domain}.com`) && !new URL(next).hostname.endsWith(`.${domain}.com`)) {
          redirectsTo = next;
          finalUrl = next;
          break;
        }
        current = next;
        continue;
      }

      body = await res.text();
      finalUrl = current;
      break;
    }

    if (!body && !redirectsTo) {
      return { checked_url: url, live: false, status_code: statusCode, title: null, description: null, parked: false, redirects_to: null, error: `HTTP ${statusCode} — no body` };
    }

    const title       = extractTitle(body);
    const description = extractDescription(body);
    const parked      = body.length > 0 ? isParkedPage(title, body) : false;
    const live        = statusCode !== null && statusCode >= 200 && statusCode < 400;

    return {
      checked_url:  url,
      live,
      status_code:  statusCode,
      title,
      description,
      parked,
      redirects_to: redirectsTo,
      error: null,
    };
  } catch (err) {
    // Domain doesn't resolve or TLS fails — not live
    const msg = err instanceof Error ? err.message : String(err);
    return {
      checked_url:  url,
      live:         false,
      status_code:  null,
      title:        null,
      description:  null,
      parked:       false,
      redirects_to: null,
      error:        msg,
    };
  }
}
