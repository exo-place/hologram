/**
 * Web chat routes.
 *
 * POST   /api/channels              -- create web channel
 * GET    /api/channels              -- list web channels
 * DELETE /api/channels/:id          -- delete web channel
 * PATCH  /api/channels/:id          -- update channel (name, entity_ids)
 * GET    /api/channels/:id/messages -- message history
 * POST   /api/channels/:id/messages -- send message (stores + triggers AI response)
 * GET    /api/channels/:id/stream   -- SSE stream for the channel
 *
 * Web channel IDs use the format "web:<uuid>" — they coexist with Discord channel
 * IDs in the messages table without collision.
 */

import { randomUUID } from "crypto";
import { getDb } from "../../db/index";
import { addMessage, getMessages } from "../../db/discord";
import { safeParseFallback } from "../../db/entities";
import { ok, err, parseBody, type RouteHandler } from "../helpers";
import { info } from "../../logger";
import type { CreateChannelBody, UpdateChannelBody, SendMessageBody, ApiWebChannel } from "../types";

// ── DB helpers ──────────────────────────────────────────────────────────────

function rowToChannel(row: { id: string; name: string | null; entity_ids: string; created_at: string }): ApiWebChannel {
  return {
    id: row.id,
    name: row.name,
    entity_ids: safeParseFallback<number[]>(row.entity_ids, []),
    created_at: row.created_at,
  };
}

function listChannels(): ApiWebChannel[] {
  const db = getDb();
  const rows = db.prepare(`SELECT id, name, entity_ids, created_at FROM web_channels ORDER BY created_at DESC`).all() as Parameters<typeof rowToChannel>[0][];
  return rows.map(rowToChannel);
}

function getChannel(id: string): ApiWebChannel | null {
  const db = getDb();
  const row = db.prepare(`SELECT id, name, entity_ids, created_at FROM web_channels WHERE id = ?`).get(id) as Parameters<typeof rowToChannel>[0] | null;
  return row ? rowToChannel(row) : null;
}

function createChannel(id: string, name: string | null, entityIds: number[]): ApiWebChannel {
  const db = getDb();
  db.prepare(`INSERT INTO web_channels (id, name, entity_ids) VALUES (?, ?, ?)`).run(id, name, JSON.stringify(entityIds));
  return getChannel(id)!;
}

function updateChannel(id: string, updates: { name?: string | null; entity_ids?: number[] }): ApiWebChannel | null {
  const db = getDb();
  const sets: string[] = [];
  const values: (string | null)[] = [];
  if ("name" in updates) { sets.push("name = ?"); values.push(updates.name ?? null); }
  if ("entity_ids" in updates) { sets.push("entity_ids = ?"); values.push(JSON.stringify(updates.entity_ids)); }
  if (sets.length === 0) return getChannel(id);
  values.push(id);
  const result = db.prepare(`UPDATE web_channels SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  if (result.changes === 0) return null;
  return getChannel(id);
}

function deleteChannel(id: string): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM web_channels WHERE id = ?`).run(id);
  return result.changes > 0;
}

// ── SSE channel map ─────────────────────────────────────────────────────────
// Maps channelId → set of SSE response controllers (one per open client)
const sseClients = new Map<string, Set<ReadableStreamDefaultController>>();

/** Push a raw SSE line to all listeners of a channel */
export function broadcastSSE(channelId: string, event: unknown): void {
  const clients = sseClients.get(channelId);
  if (!clients || clients.size === 0) return;
  const line = `data: ${JSON.stringify(event)}\n\n`;
  const encoded = new TextEncoder().encode(line);
  for (const controller of clients) {
    try { controller.enqueue(encoded); } catch { /* client disconnected */ }
  }
}

// ── Route handler ────────────────────────────────────────────────────────────

export const chatRoutes: RouteHandler = async (req, url) => {
  const path = url.pathname;
  const method = req.method;

  // POST /api/channels
  if (path === "/api/channels" && method === "POST") {
    const body = await parseBody<CreateChannelBody>(req);
    if (!body) return err("Invalid JSON body");
    if (!Array.isArray(body.entity_ids)) return err("entity_ids must be an array");
    const id = `web:${randomUUID()}`;
    const channel = createChannel(id, body.name ?? null, body.entity_ids);
    info("Web channel created", { channelId: id });
    return ok(channel, 201);
  }

  // GET /api/channels
  if (path === "/api/channels" && method === "GET") {
    return ok(listChannels());
  }

  // Routes with /:id
  const idMatch = path.match(/^\/api\/channels\/(web:[^/]+)(\/.*)?$/);
  if (!idMatch) return null;

  const channelId = idMatch[1];
  const sub = idMatch[2] ?? "";

  // PATCH /api/channels/:id
  if (sub === "" && method === "PATCH") {
    const body = await parseBody<UpdateChannelBody>(req);
    if (!body) return err("Invalid JSON body");
    const updates: Parameters<typeof updateChannel>[1] = {};
    if ("name" in body) updates.name = body.name;
    if ("entity_ids" in body) {
      if (!Array.isArray(body.entity_ids)) return err("entity_ids must be an array");
      updates.entity_ids = body.entity_ids;
    }
    const channel = updateChannel(channelId, updates);
    if (!channel) return err("Not found", 404);
    return ok(channel);
  }

  // DELETE /api/channels/:id
  if (sub === "" && method === "DELETE") {
    const deleted = deleteChannel(channelId);
    if (!deleted) return err("Not found", 404);
    return ok({ deleted: true });
  }

  // GET /api/channels/:id/messages
  if (sub === "/messages" && method === "GET") {
    const channel = getChannel(channelId);
    if (!channel) return err("Not found", 404);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
    const messages = getMessages(channelId, limit);
    return ok(messages);
  }

  // POST /api/channels/:id/messages
  if (sub === "/messages" && method === "POST") {
    const channel = getChannel(channelId);
    if (!channel) return err("Not found", 404);
    const body = await parseBody<SendMessageBody>(req);
    if (!body) return err("Invalid JSON body");
    if (!body.content?.trim()) return err("content is required");

    const authorId = body.author_id ?? "web-user";
    const authorName = body.author_name ?? "User";
    const message = addMessage(channelId, authorId, authorName, body.content.trim());
    if (!message) return err("Failed to store message", 500);

    // Broadcast the user message to SSE clients
    broadcastSSE(channelId, { type: "message", message });

    // AI response is triggered by the chat-adapter (Phase 3).
    // For Phase 1 we return the stored message only.
    return ok({ message, ai_response: null }, 201);
  }

  // GET /api/channels/:id/stream  — SSE
  if (sub === "/stream" && method === "GET") {
    const channel = getChannel(channelId);
    if (!channel) return err("Not found", 404);

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
