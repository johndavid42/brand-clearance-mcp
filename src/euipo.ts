import type { TrademarkSearchResult } from "./types.js";

// ── EUIPO trademark search — server-side unavailable ─────────────────────
// The EUIPO eSearch portal (copla/ctmsearch/json) requires a browser session
// cookie. Server-side requests hang indefinitely without one.
// No public unauthenticated programmatic API exists.
// This module returns a documented no-op so it doesn't block the parallel fetch.

export async function searchEuipoTrademarks(
  _brandName: string,
  _rows = 20,
): Promise<TrademarkSearchResult> {
  return {
    hits: [],
    source: "EUIPO",
    total_found: 0,
    error: "EUIPO requires browser session cookies — not accessible server-side without auth",
  };
}
