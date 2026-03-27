/**
 * Debug routes — wraps src/debug/ inspection functions.
 *
 * GET /api/debug/bindings              -- binding graph (optional ?guild=&channel=)
 * GET /api/debug/errors                -- eval errors (optional ?entity=&limit=)
 * GET /api/debug/embeddings            -- embedding coverage (?entity= required)
 * GET /api/debug/embedding-status      -- overall embedding model status
 * GET /api/debug/trace/:entityId       -- fact eval trace (?channel=&guild=)
 * GET /api/debug/simulate/:channelId   -- response simulation for channel (?guild=)
 */

import { getBindingGraph, getEvalErrors } from "../../debug/state";
import { getEmbeddingCoverage, getEmbeddingStatus } from "../../debug/embeddings";
import { traceFacts, simulateResponse } from "../../debug/evaluation";
import { ok, err, parseId, type RouteHandler } from "../helpers";

export const debugRoutes: RouteHandler = async (req, url) => {
  const path = url.pathname;
  const method = req.method;
  if (method !== "GET") return null;

  // GET /api/debug/bindings
  if (path === "/api/debug/bindings") {
    const guildId = url.searchParams.get("guild") ?? undefined;
    const channelId = url.searchParams.get("channel") ?? undefined;
    return ok(getBindingGraph(guildId, channelId));
  }

  // GET /api/debug/errors
  if (path === "/api/debug/errors") {
    const entityParam = url.searchParams.get("entity");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
    const entityId = entityParam ? parseId(entityParam) : undefined;
    if (entityParam && entityId === null) return err("Invalid entity id");
    return ok(getEvalErrors(entityId ?? undefined, limit));
  }

  // GET /api/debug/embedding-status
  if (path === "/api/debug/embedding-status") {
    return ok(getEmbeddingStatus());
  }

  // GET /api/debug/embeddings  — requires ?entity=<id>
  if (path === "/api/debug/embeddings") {
    const entityParam = url.searchParams.get("entity");
    if (!entityParam) return err("entity query param is required");
    const entityId = parseId(entityParam);
    if (entityId === null) return err("Invalid entity id");
    return ok(getEmbeddingCoverage(entityId));
  }

  // GET /api/debug/trace/:entityId
  const traceMatch = path.match(/^\/api\/debug\/trace\/(\d+)$/);
  if (traceMatch) {
    const entityId = parseId(traceMatch[1]);
    if (entityId === null) return err("Invalid entity id");
    const channelId = url.searchParams.get("channel") ?? "web:debug";
    const guildId = url.searchParams.get("guild") ?? undefined;
    try {
      return ok(traceFacts(entityId, channelId, guildId));
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e), 500);
    }
  }

  // GET /api/debug/simulate/:channelId
  const simMatch = path.match(/^\/api\/debug\/simulate\/(.+)$/);
  if (simMatch) {
    const channelId = decodeURIComponent(simMatch[1]);
    const guildId = url.searchParams.get("guild") ?? undefined;
    try {
      return ok(simulateResponse(channelId, guildId));
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e), 500);
    }
  }

  return null;
};
