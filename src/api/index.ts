/**
 * Web API server — Bun.serve() with REST routes + optional static file serving.
 *
 * Started when WEB environment variable is not "false".
 * Shares the database and AI pipeline with the Discord bot.
 */

import { entityRoutes } from "./routes/entities";
import { chatRoutes } from "./routes/chat";
import { debugRoutes } from "./routes/debug";
import { info, error } from "../logger";
import { type RouteHandler } from "./helpers";
export type { RouteHandler } from "./helpers";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function corsResponse(status = 204): Response {
  return new Response(null, { status, headers: CORS_HEADERS });
}

function addCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

const API_HANDLERS: RouteHandler[] = [entityRoutes, chatRoutes, debugRoutes];

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // CORS preflight
  if (req.method === "OPTIONS") return corsResponse();

  // API routes
  if (url.pathname.startsWith("/api/")) {
    for (const handler of API_HANDLERS) {
      try {
        const res = await handler(req, url);
        if (res !== null) return addCors(res);
      } catch (e) {
        error("API handler error", e, { path: url.pathname });
        return addCors(Response.json({ ok: false, error: "Internal server error" }, { status: 500 }));
      }
    }
    return addCors(Response.json({ ok: false, error: "Not found" }, { status: 404 }));
  }

  // Static files (web/ dist)
  return serveStatic(url.pathname);
}

async function serveStatic(pathname: string): Promise<Response> {
  // Sanitize path to prevent directory traversal
  const clean = pathname.replace(/\.\./g, "").replace(/\/+/g, "/");
  const base = `${import.meta.dir}/../../web/dist`;
  const filePath = clean === "/" ? `${base}/index.html` : `${base}${clean}`;

  const file = Bun.file(filePath);
  if (await file.exists()) {
    return new Response(file);
  }

  // SPA fallback — return index.html for unmatched routes
  const index = Bun.file(`${base}/index.html`);
  if (await index.exists()) {
    return new Response(index);
  }

  return new Response("Not found", { status: 404 });
}

export async function startApi(port = 3000): Promise<void> {
  const server = Bun.serve({
    port,
    fetch: handleRequest,
  });
  info("Web API started", { port: server.port });
}
