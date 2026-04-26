/**
 * Moderation API routes — mutes management.
 *
 * All routes require authentication (Discord OAuth session cookie).
 *
 * GET    /api/mutes                    list active mutes (filtered)
 * POST   /api/mutes                    create a mute
 * DELETE /api/mutes/:id                remove a mute
 * POST   /api/mutes/bulk-clear         remove all mutes for a scope (admin only)
 */

import { ok, err, parseBody } from "../helpers";
import type { RouteHandler } from "../helpers";
import { resolveSession } from "./auth";
import {
  addMute,
  removeMute,
  listActiveMutes,
  recordModEvent,
  type MuteScopeType,
  type AddMuteParams,
} from "../../db/moderation";

function requireAuth(req: Request): string | null {
  const session = resolveSession(req);
  return session?.discord_user_id ?? null;
}

export const moderationRoutes: RouteHandler = async (req, url) => {
  // GET /api/mutes
  if (url.pathname === "/api/mutes" && req.method === "GET") {
    const userId = requireAuth(req);
    if (!userId) return err("Not authenticated", 401);

    const scopeType = url.searchParams.get("scope_type") as MuteScopeType | null;
    const scopeId = url.searchParams.get("scope_id") ?? undefined;
    const guildId = url.searchParams.get("guild_id");
    const channelId = url.searchParams.get("channel_id");

    const mutes = listActiveMutes({
      scope_type: scopeType ?? undefined,
      scope_id: scopeId,
      guild_id: guildId !== null ? (guildId === "" ? null : guildId) : undefined,
      channel_id: channelId !== null ? (channelId === "" ? null : channelId) : undefined,
    });

    return ok(mutes);
  }

  // POST /api/mutes
  if (url.pathname === "/api/mutes" && req.method === "POST") {
    const userId = requireAuth(req);
    if (!userId) return err("Not authenticated", 401);

    const body = await parseBody<{
      scope_type: string;
      scope_id: string;
      guild_id?: string | null;
      channel_id?: string | null;
      expires_at?: string | null;
      reason?: string | null;
    }>(req);
    if (!body) return err("Invalid request body");

    const validScopes: MuteScopeType[] = ["entity", "owner", "channel", "guild"];
    if (!validScopes.includes(body.scope_type as MuteScopeType)) {
      return err("Invalid scope_type");
    }
    if (!body.scope_id) return err("scope_id is required");

    const params: AddMuteParams = {
      scope_type: body.scope_type as MuteScopeType,
      scope_id: body.scope_id,
      guild_id: body.guild_id ?? null,
      channel_id: body.channel_id ?? null,
      expires_at: body.expires_at ?? null,
      created_by: userId,
      reason: body.reason ?? null,
    };

    const mute = addMute(params);
    recordModEvent({
      event_type: "muted",
      actor_id: userId,
      target_type: params.scope_type,
      target_id: params.scope_id,
      guild_id: params.guild_id ?? null,
      details: { mute_id: mute.id, reason: params.reason, expires_at: params.expires_at },
    });

    return ok(mute);
  }

  // DELETE /api/mutes/bulk-clear
  if (url.pathname === "/api/mutes/bulk-clear" && req.method === "POST") {
    const userId = requireAuth(req);
    if (!userId) return err("Not authenticated", 401);

    const body = await parseBody<{ guild_id?: string; scope_type?: string }>(req);
    if (!body) return err("Invalid request body");

    const mutes = listActiveMutes({
      guild_id: body.guild_id ?? undefined,
      scope_type: body.scope_type as MuteScopeType | undefined,
    });
    let removed = 0;
    for (const m of mutes) {
      removeMute(m.id);
      removed++;
    }

    recordModEvent({
      event_type: "unmuted",
      actor_id: userId,
      guild_id: body.guild_id ?? null,
      details: { bulk: true, removed, scope_type: body.scope_type },
    });

    return ok({ removed });
  }

  // DELETE /api/mutes/:id
  const muteMatch = url.pathname.match(/^\/api\/mutes\/(\d+)$/);
  if (muteMatch && req.method === "DELETE") {
    const userId = requireAuth(req);
    if (!userId) return err("Not authenticated", 401);

    const id = parseInt(muteMatch[1]!, 10);
    if (isNaN(id)) return err("Invalid mute ID");

    const removed = removeMute(id);
    if (!removed) return err("Mute not found", 404);

    recordModEvent({
      event_type: "unmuted",
      actor_id: userId,
      details: { mute_id: id },
    });

    return ok({ removed: true });
  }

  return null;
};
