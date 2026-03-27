/**
 * Discord channel browse routes.
 *
 * GET  /api/discord-channels           -- list channels with entity bindings
 * GET  /api/discord-channels/:id/messages -- message history
 * POST /api/discord-channels/:id/messages -- send message to Discord (requires bot)
 * GET  /api/discord-channels/:id/stream   -- SSE stream (real-time when bot broadcasts)
 */

import { getDb } from "../../db/index";
import { getMessages } from "../../db/discord";
import { getEntity, getEntityConfig } from "../../db/entities";
import { ok, err, parseBody, type RouteHandler } from "../helpers";
import { sseClients } from "./chat";
import { sendToDiscordChannel, isBotConnected } from "../../bot/bridge";
import type { ApiDiscordChannel } from "../types";

export type { ApiDiscordChannel };

export const discordChannelRoutes: RouteHandler = async (req, url) => {
  const path = url.pathname;
  const method = req.method;

  // GET /api/discord-channels
  if (path === "/api/discord-channels" && method === "GET") {
    const db = getDb();
    const rows = db.prepare(`
      SELECT de.discord_id,
             GROUP_CONCAT(e.id) as entity_ids,
             GROUP_CONCAT(e.name) as entity_names,
             dcm.name as channel_name
      FROM discord_entities de
      JOIN entities e ON de.entity_id = e.id
      LEFT JOIN discord_channel_meta dcm ON dcm.channel_id = de.discord_id
      WHERE de.discord_type = 'channel'
      GROUP BY de.discord_id
    `).all() as { discord_id: string; entity_ids: string; entity_names: string; channel_name: string | null }[];

    const channels: ApiDiscordChannel[] = rows.map(row => {
      const latest = db.prepare(
        `SELECT author_name, content, created_at FROM messages WHERE channel_id = ? ORDER BY created_at DESC LIMIT 1`
      ).get(row.discord_id) as { author_name: string; content: string; created_at: string } | null;
      return {
        id: row.discord_id,
        name: row.channel_name,
        entity_ids: row.entity_ids.split(",").map(Number),
        entity_names: row.entity_names.split(","),
        latest_message: latest,
      };
    });

    // Sort: channels with messages first (most recent), then others
    channels.sort((a, b) => {
      const ta = a.latest_message?.created_at ?? "";
      const tb = b.latest_message?.created_at ?? "";
      return tb.localeCompare(ta);
    });

    return ok(channels);
  }

  // Routes with /:id (Discord snowflakes are all digits)
  const idMatch = path.match(/^\/api\/discord-channels\/(\d+)(\/.*)?$/);
  if (!idMatch) return null;

  const channelId = idMatch[1];
  const sub = idMatch[2] ?? "";

  // GET /api/discord-channels/:id/messages
  if (sub === "/messages" && method === "GET") {
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
    const messages = getMessages(channelId, limit);
    return ok(messages);
  }

  // POST /api/discord-channels/:id/messages — send a message to Discord via the bot
  if (sub === "/messages" && method === "POST") {
    if (!isBotConnected()) return err("Bot not connected", 503);
    const body = await parseBody<{ content: string; entity_id?: number; author_name?: string }>(req);
    if (!body?.content?.trim()) return err("content is required");

    let authorName: string | undefined;
    let avatarUrl: string | undefined;

    if (body.entity_id != null) {
      const entity = getEntity(body.entity_id);
      const config = entity ? getEntityConfig(body.entity_id) : null;
      authorName = entity?.name;
      avatarUrl = config?.config_avatar ?? undefined;
    } else if (body.author_name?.trim()) {
      authorName = body.author_name.trim();
    }

    await sendToDiscordChannel(channelId, body.content.trim(), authorName, avatarUrl);
    return ok({ sent: true });
  }

  // GET /api/discord-channels/:id/stream — SSE (shared map with web channels)
  if (sub === "/stream" && method === "GET") {
    let controller!: ReadableStreamDefaultController;
    const stream = new ReadableStream({
      start(c) {
        controller = c;
        if (!sseClients.has(channelId)) sseClients.set(channelId, new Set());
        sseClients.get(channelId)!.add(controller);
      },
      cancel() {
        sseClients.get(channelId)?.delete(controller);
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  return null;
};
