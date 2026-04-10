/**
 * Discord binding CRUD routes.
 *
 * GET    /api/bindings                   -- list bindings (filter: discord_id, discord_type, entity_id)
 * POST   /api/bindings                   -- add a binding
 * DELETE /api/bindings/:id               -- remove a binding by row id
 */

import {
  addDiscordEntity,
  listDiscordMappings,
  clearPersonaCache,
  type DiscordType,
} from "../../db/discord";
import { getDb } from "../../db/index";
import { getEntity } from "../../db/entities";
import { ok, err, parseBody, type RouteHandler } from "../helpers";
import type { ApiBindingEntry, CreateBindingBody } from "../types";

const DISCORD_TYPES = new Set<string>(["user", "channel", "guild"]);

function toApiBinding(row: {
  id: number;
  discord_id: string;
  discord_type: string;
  scope_guild_id: string | null;
  scope_channel_id: string | null;
  entity_id: number;
}): ApiBindingEntry {
  const entity = getEntity(row.entity_id);
  return {
    id: row.id,
    discord_id: row.discord_id,
    discord_type: row.discord_type,
    entity_id: row.entity_id,
    entity_name: entity?.name ?? String(row.entity_id),
    scope_guild_id: row.scope_guild_id,
    scope_channel_id: row.scope_channel_id,
  };
}

export const bindingRoutes: RouteHandler = async (req, url) => {
  const path = url.pathname;
  const method = req.method;

  // GET /api/bindings
  if (path === "/api/bindings" && method === "GET") {
    const db = getDb();
    const discordId = url.searchParams.get("discord_id");
    const discordType = url.searchParams.get("discord_type");
    const entityId = url.searchParams.get("entity_id");

    if (discordId && discordType) {
      if (!DISCORD_TYPES.has(discordType)) return err("Invalid discord_type");
      const rows = listDiscordMappings(discordId, discordType as DiscordType);
      return ok(rows.map(toApiBinding));
    }

    let query = `SELECT * FROM discord_entities`;
    const params: (string | number)[] = [];
    const clauses: string[] = [];

    if (discordId) { clauses.push(`discord_id = ?`); params.push(discordId); }
    if (discordType) {
      if (!DISCORD_TYPES.has(discordType)) return err("Invalid discord_type");
      clauses.push(`discord_type = ?`); params.push(discordType);
    }
    if (entityId) {
      const id = Number(entityId);
      if (!Number.isInteger(id) || id <= 0) return err("Invalid entity_id");
      clauses.push(`entity_id = ?`); params.push(id);
    }

    if (clauses.length > 0) query += ` WHERE ${clauses.join(" AND ")}`;
    query += ` ORDER BY discord_type, discord_id`;

    const rows = db.prepare(query).all(...params) as Parameters<typeof toApiBinding>[0][];
    return ok(rows.map(toApiBinding));
  }

  // POST /api/bindings
  if (path === "/api/bindings" && method === "POST") {
    const body = await parseBody<CreateBindingBody>(req);
    if (!body?.discord_id?.trim()) return err("discord_id is required");
    if (!body.discord_type || !DISCORD_TYPES.has(body.discord_type)) return err("discord_type must be user, channel, or guild");
    if (!body.entity_id || !Number.isInteger(body.entity_id) || body.entity_id <= 0) return err("entity_id is required");
    if (!getEntity(body.entity_id)) return err("Entity not found", 404);

    const binding = addDiscordEntity(
      body.discord_id.trim(),
      body.discord_type as DiscordType,
      body.entity_id,
      body.scope_guild_id?.trim() || undefined,
      body.scope_channel_id?.trim() || undefined,
    );
    if (!binding) return err("Binding already exists", 409);
    return ok(toApiBinding(binding), 201);
  }

  // DELETE /api/bindings/:id
  const idMatch = path.match(/^\/api\/bindings\/(\d+)$/);
  if (idMatch && method === "DELETE") {
    const id = Number(idMatch[1]);
    const db = getDb();
    const existing = db.prepare(`SELECT * FROM discord_entities WHERE id = ?`).get(id) as Parameters<typeof toApiBinding>[0] | null;
    if (!existing) return err("Binding not found", 404);

    if (existing.discord_type === "user") clearPersonaCache();
    db.prepare(`DELETE FROM discord_entities WHERE id = ?`).run(id);
    return ok({ deleted: true });
  }

  return null;
};
