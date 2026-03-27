/**
 * Entity CRUD routes.
 *
 * GET    /api/entities               -- list (limit/offset/search query params)
 * POST   /api/entities               -- create
 * GET    /api/entities/:id           -- get with facts
 * PUT    /api/entities/:id           -- rename
 * DELETE /api/entities/:id           -- delete
 * GET    /api/entities/:id/facts     -- list facts
 * POST   /api/entities/:id/facts     -- add fact
 * PUT    /api/entities/:id/facts/:fid -- update fact
 * DELETE /api/entities/:id/facts/:fid -- remove fact
 * GET    /api/entities/:id/config    -- get config
 * PATCH  /api/entities/:id/config    -- update config (partial)
 * GET    /api/entities/:id/template  -- get template
 * PUT    /api/entities/:id/template  -- set template (null to clear)
 * GET    /api/entities/:id/system-template  -- get system template
 * PUT    /api/entities/:id/system-template  -- set system template
 * GET    /api/entities/:id/memories  -- list memories
 * POST   /api/entities/:id/memories  -- add memory
 * DELETE /api/entities/:id/memories/:mid -- remove memory
 */

import {
  createEntity,
  getEntityWithFacts,
  listEntities,
  searchEntities,
  updateEntity,
  deleteEntity,
  addFact,
  updateFact,
  removeFact,
  getEntityConfig,
  setEntityConfig,
  getEntityTemplate,
  setEntityTemplate,
  getEntitySystemTemplate,
  setEntitySystemTemplate,
} from "../../db/entities";
import { getMemoriesForEntity, addMemory, removeMemory } from "../../db/memories";
import { ok, err, parseId, parseBody, type RouteHandler } from "../helpers";
import type {
  CreateEntityBody,
  UpdateEntityBody,
  CreateFactBody,
  UpdateFactBody,
  CreateMemoryBody,
} from "../types";

export const entityRoutes: RouteHandler = async (req, url) => {
  const path = url.pathname;
  const method = req.method;

  // POST /api/entities
  if (path === "/api/entities" && method === "POST") {
    const body = await parseBody<CreateEntityBody>(req);
    if (!body) return err("Invalid JSON body");
    const { name, owned_by } = body;
    if (!name?.trim()) return err("name is required");
    const entity = createEntity(name.trim(), owned_by);
    return ok(entity, 201);
  }

  // GET /api/entities
  if (path === "/api/entities" && method === "GET") {
    const q = url.searchParams.get("q");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const entities = q ? searchEntities(q, limit) : listEntities(limit, offset);
    return ok(entities);
  }

  // Routes with /:id
  const idMatch = path.match(/^\/api\/entities\/(\d+)(\/.*)?$/);
  if (!idMatch) return null;

  const entityId = parseId(idMatch[1]);
  if (entityId === null) return err("Invalid entity id");
  const sub = idMatch[2] ?? "";

  // GET /api/entities/:id
  if (sub === "" && method === "GET") {
    const entity = getEntityWithFacts(entityId);
    if (!entity) return err("Not found", 404);
    return ok(entity);
  }

  // PUT /api/entities/:id
  if (sub === "" && method === "PUT") {
    const body = await parseBody<UpdateEntityBody>(req);
    if (!body) return err("Invalid JSON body");
    if (!body.name?.trim()) return err("name is required");
    const entity = updateEntity(entityId, body.name.trim());
    if (!entity) return err("Not found", 404);
    return ok(entity);
  }

  // DELETE /api/entities/:id
  if (sub === "" && method === "DELETE") {
    const deleted = deleteEntity(entityId);
    if (!deleted) return err("Not found", 404);
    return ok({ deleted: true });
  }

  // ── Facts ──────────────────────────────────────────────────────────────────

  // GET /api/entities/:id/facts
  if (sub === "/facts" && method === "GET") {
    const entity = getEntityWithFacts(entityId);
    if (!entity) return err("Not found", 404);
    return ok(entity.facts);
  }

  // POST /api/entities/:id/facts
  if (sub === "/facts" && method === "POST") {
    const body = await parseBody<CreateFactBody>(req);
    if (!body) return err("Invalid JSON body");
    if (!body.content?.trim()) return err("content is required");
    const entity = getEntityWithFacts(entityId);
    if (!entity) return err("Not found", 404);
    const fact = addFact(entityId, body.content.trim());
    return ok(fact, 201);
  }

  // Routes with /facts/:fid
  const factMatch = sub.match(/^\/facts\/(\d+)$/);
  if (factMatch) {
    const factId = parseId(factMatch[1]);
    if (factId === null) return err("Invalid fact id");

    // PUT /api/entities/:id/facts/:fid
    if (method === "PUT") {
      const body = await parseBody<UpdateFactBody>(req);
      if (!body) return err("Invalid JSON body");
      if (body.content === undefined) return err("content is required");
      const entity = getEntityWithFacts(entityId);
      if (!entity) return err("Not found", 404);
      const fact = updateFact(factId, body.content);
      if (!fact || fact.entity_id !== entityId) return err("Not found", 404);
      return ok(fact);
    }

    // DELETE /api/entities/:id/facts/:fid
    if (method === "DELETE") {
      const entity = getEntityWithFacts(entityId);
      if (!entity) return err("Not found", 404);
      const deleted = removeFact(factId);
      if (!deleted) return err("Not found", 404);
      return ok({ deleted: true });
    }

    return null;
  }

  // ── Config ─────────────────────────────────────────────────────────────────

  // GET /api/entities/:id/config
  if (sub === "/config" && method === "GET") {
    const config = getEntityConfig(entityId);
    if (!config) return err("Not found", 404);
    return ok(config);
  }

  // PATCH /api/entities/:id/config
  if (sub === "/config" && method === "PATCH") {
    const body = await parseBody<Record<string, unknown>>(req);
    if (!body) return err("Invalid JSON body");
    const entity = getEntityWithFacts(entityId);
    if (!entity) return err("Not found", 404);
    setEntityConfig(entityId, body as Parameters<typeof setEntityConfig>[1]);
    return ok(getEntityConfig(entityId));
  }

  // ── Templates ──────────────────────────────────────────────────────────────

  // GET /api/entities/:id/template
  if (sub === "/template" && method === "GET") {
    const entity = getEntityWithFacts(entityId);
    if (!entity) return err("Not found", 404);
    return ok({ template: getEntityTemplate(entityId) });
  }

  // PUT /api/entities/:id/template
  if (sub === "/template" && method === "PUT") {
    const body = await parseBody<{ template: string | null }>(req);
    if (body === null) return err("Invalid JSON body");
    const entity = getEntityWithFacts(entityId);
    if (!entity) return err("Not found", 404);
    setEntityTemplate(entityId, body.template ?? null);
    return ok({ template: getEntityTemplate(entityId) });
  }

  // GET /api/entities/:id/system-template
  if (sub === "/system-template" && method === "GET") {
    const entity = getEntityWithFacts(entityId);
    if (!entity) return err("Not found", 404);
    return ok({ system_template: getEntitySystemTemplate(entityId) });
  }

  // PUT /api/entities/:id/system-template
  if (sub === "/system-template" && method === "PUT") {
    const body = await parseBody<{ system_template: string | null }>(req);
    if (body === null) return err("Invalid JSON body");
    const entity = getEntityWithFacts(entityId);
    if (!entity) return err("Not found", 404);
    setEntitySystemTemplate(entityId, body.system_template ?? null);
    return ok({ system_template: getEntitySystemTemplate(entityId) });
  }

  // ── Memories ───────────────────────────────────────────────────────────────

  // GET /api/entities/:id/memories
  if (sub === "/memories" && method === "GET") {
    const entity = getEntityWithFacts(entityId);
    if (!entity) return err("Not found", 404);
    return ok(getMemoriesForEntity(entityId));
  }

  // POST /api/entities/:id/memories
  if (sub === "/memories" && method === "POST") {
    const body = await parseBody<CreateMemoryBody>(req);
    if (!body) return err("Invalid JSON body");
    if (!body.content?.trim()) return err("content is required");
    const entity = getEntityWithFacts(entityId);
    if (!entity) return err("Not found", 404);
    const memory = await addMemory(entityId, body.content.trim());
    return ok(memory, 201);
  }

  // DELETE /api/entities/:id/memories/:mid
  const memMatch = sub.match(/^\/memories\/(\d+)$/);
  if (memMatch) {
    const memId = parseId(memMatch[1]);
    if (memId === null) return err("Invalid memory id");

    if (method === "DELETE") {
      const entity = getEntityWithFacts(entityId);
      if (!entity) return err("Not found", 404);
      const deleted = removeMemory(memId);
      if (!deleted) return err("Not found", 404);
      return ok({ deleted: true });
    }

    return null;
  }

  return null;
};
