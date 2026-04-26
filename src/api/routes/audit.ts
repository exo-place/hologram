/**
 * Audit log API routes.
 *
 * GET /api/audit   — list moderation events (auth required)
 */

import { ok, err } from "../helpers";
import type { RouteHandler } from "../helpers";
import { requireAuth } from "./auth";
import { getModEvents, type ModEventType } from "../../db/moderation";

export const auditRoutes: RouteHandler = async (req, url) => {
  if (!url.pathname.startsWith("/api/audit")) return null;

  if (url.pathname === "/api/audit" && req.method === "GET") {
    if (!requireAuth(req)) return err("Not authenticated", 401);

    const guildId = url.searchParams.get("guild_id") ?? undefined;
    const channelId = url.searchParams.get("channel_id") ?? undefined;
    const targetType = url.searchParams.get("target_type") ?? undefined;
    const targetId = url.searchParams.get("target_id") ?? undefined;
    const eventType = url.searchParams.get("event_type") as ModEventType | null;
    const hoursRaw = url.searchParams.get("hours");
    const limitRaw = url.searchParams.get("limit");

    const events = getModEvents({
      guild_id: guildId,
      channel_id: channelId,
      target_type: targetType,
      target_id: targetId,
      event_type: eventType ?? undefined,
      hours: hoursRaw ? parseInt(hoursRaw, 10) : undefined,
      limit: limitRaw ? parseInt(limitRaw, 10) : 100,
    });

    return ok(events);
  }

  return null;
};
