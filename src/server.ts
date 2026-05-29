import express, { type Request, type Response } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createContextMiddleware } from "@ctxprotocol/sdk";

import { TOOLS } from "./tools.js";
import {
  runBrandClearance,
  getTrademarkHits,
  getDomainConflicts,
  getCompanyConflicts,
  getCacheSize,
} from "./fetcher.js";
import { ENV } from "./env.js";

// ── Logger ─────────────────────────────────────────────────────────────────

const log = {
  info:  (msg: string, meta?: object) => console.log( `[INFO]  ${msg}`, meta ? JSON.stringify(meta) : ""),
  warn:  (msg: string, meta?: object) => console.warn( `[WARN]  ${msg}`, meta ? JSON.stringify(meta) : ""),
  error: (msg: string, meta?: object) => console.error(`[ERROR] ${msg}`, meta ? JSON.stringify(meta) : ""),
};

// ── Tool handler ───────────────────────────────────────────────────────────

async function handleTool(name: string, args: Record<string, unknown>) {
  const brandName = String(args.brand_name ?? "").trim();
  if (!brandName) throw new Error("brand_name is required");

  switch (name) {
    case "check_brand_clearance": {
      const niceClass = args.nice_class as number | undefined;
      const full      = await runBrandClearance(brandName, niceClass);

      // Return a lean response for check_brand_clearance to keep synthesis fast:
      // - Only LIVE/REGISTERED/PENDING marks (DEAD marks are historical — not actionable)
      // - Goods descriptions capped at 150 chars
      // - Company registrations capped at 5 (sorted by similarity already)
      // - Typosquats capped at 10 (registered only, most dangerous first)
      // - trademark_total and trademark_active added so agents know there's more
      // Full data is still available via search_trademarks / search_company_names.
      const activeHits = full.trademark_hits.filter(
        h => h.status === "LIVE" || h.status === "REGISTERED" || h.status === "PENDING",
      );

      return {
        ...full,
        trademark_hits: activeHits.slice(0, 10).map(h => ({
          ...h,
          goods_description: h.goods_description
            ? h.goods_description.slice(0, 150) + (h.goods_description.length > 150 ? "…" : "")
            : null,
        })),
        trademark_total:  full.trademark_hits.length,
        trademark_active: activeHits.length,
        company_registrations: full.company_registrations.slice(0, 5),
        typosquat_domains:     full.typosquat_domains.slice(0, 10),
      };
    }

    case "search_trademarks": {
      const niceClass   = args.nice_class as number | undefined;
      const jurisdiction = (args.jurisdiction ?? "both") as string;
      const report      = await getTrademarkHits(brandName, niceClass);
      if (jurisdiction === "us") {
        report.trademark_hits = report.trademark_hits.filter(h => h.source === "USPTO");
      } else if (jurisdiction === "eu") {
        report.trademark_hits = report.trademark_hits.filter(h => h.source === "EUIPO");
      }
      return report;
    }

    case "check_domain_conflicts":
      return getDomainConflicts(brandName);

    case "search_company_names":
      return getCompanyConflicts(brandName);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── MCP Server factory ─────────────────────────────────────────────────────

function makeServer(): Server {
  const server = new Server(
    { name: "brand-clearance", version: "1.0.0" },
    { capabilities: { tools: { listChanged: false } } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    log.info("tools/list");
    return { tools: TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const t0 = Date.now();
    log.info("tool/call", { name, brand: args.brand_name });

    try {
      const result = await handleTool(name, args as Record<string, unknown>);
      log.info("tool/ok", { name, ms: Date.now() - t0 });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("tool/err", { name, ms: Date.now() - t0, message });
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
        structuredContent: { error: message },
      };
    }
  });

  return server;
}

// ── Express app ────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

app.use((req, _res, next) => {
  log.info("request", { method: req.method, path: req.path, body_method: req.body?.method });
  next();
});

if (process.env.NODE_ENV === "production") {
  app.use("/mcp", createContextMiddleware());
} else {
  console.warn("[warn] CTX middleware DISABLED (NODE_ENV !== production)");
}

// ── SSE sessions ───────────────────────────────────────────────────────────

const sessions = new Map<string, SSEServerTransport>();

app.get("/mcp", async (_req: Request, res: Response) => {
  const transport = new SSEServerTransport("/mcp", res);
  const server    = makeServer();
  sessions.set(transport.sessionId, transport);

  res.on("close", () => {
    sessions.delete(transport.sessionId);
    log.info("sse/close", { activeSessions: sessions.size });
  });

  await server.connect(transport);
});

// ── Stateless POST ─────────────────────────────────────────────────────────

app.post("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string | undefined;

  if (sessionId) {
    const transport = sessions.get(sessionId);
    if (!transport) { res.status(404).json({ error: "Session not found" }); return; }
    await transport.handlePostMessage(req, res, req.body);
    return;
  }

  const { method, id } = req.body ?? {};

  if (method === "initialize") {
    res.json({
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "brand-clearance", version: "1.0.0" },
        capabilities: { tools: { listChanged: false } },
      },
    });
    return;
  }

  if (method === "notifications/initialized") {
    log.info("notifications/initialized");
    res.status(204).end();
    return;
  }

  if (method === "notifications/cancelled") {
    log.warn("tool/cancelled", { id });
    res.json({ jsonrpc: "2.0", id, result: {} });
    return;
  }

  if (method === "tools/list") {
    log.info("tools/list");
    res.json({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }

  if (method === "tools/call") {
    const { name, arguments: args = {} } = req.body?.params ?? {};
    const t0 = Date.now();
    log.info("tool/call", { name, brand: args.brand_name });

    try {
      const result = await handleTool(name as string, args as Record<string, unknown>);
      log.info("tool/ok", { name, ms: Date.now() - t0 });
      res.json({
        jsonrpc: "2.0", id,
        result: {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("tool/err", { name, ms: Date.now() - t0, message });
      res.json({
        jsonrpc: "2.0", id,
        result: {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
          structuredContent: { error: message },
        },
      });
    }
    return;
  }

  log.warn("unknown_method", { method });
  res.status(400).json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
});

// ── Health ─────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "brand-clearance-mcp",
    version: "1.0.0",
    activeSessions: sessions.size,
    cachedBrands: getCacheSize(),
    companiesHouseEnabled: !!ENV.COMPANIES_HOUSE_API_KEY,
  });
});

// ── Start ──────────────────────────────────────────────────────────────────

app.listen(ENV.PORT, () => {
  log.info("listening", { port: ENV.PORT, env: ENV.NODE_ENV });
  if (!ENV.COMPANIES_HOUSE_API_KEY) {
    log.warn("COMPANIES_HOUSE_API_KEY not set — UK company search disabled. Get a free key at https://developer.company-information.service.gov.uk/");
  }
});
