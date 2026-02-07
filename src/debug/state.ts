/**
 * Debug functions for DB state inspection.
 *
 * Pure functions returning structured data — no Discord dependencies.
 */

import { getDb } from "../db/index";
import { getEntity } from "../db/entities";
import { getMemoriesForEntity } from "../db/memories";
import { getActiveEffects } from "../db/effects";
import { getChannelForgetTime } from "../db/discord";

// =============================================================================
// Types
// =============================================================================

export interface BindingEntry {
  id: number;
  discordId: string;
  discordType: string;
  scopeGuildId: string | null;
  scopeChannelId: string | null;
  entityId: number;
  entityName: string | null;
}

export interface BindingGraph {
  bindings: BindingEntry[];
  total: number;
}

export interface MemoryStats {
  entityId: number;
  total: number;
  frecency: { min: number; max: number; mean: number } | null;
  scopeBreakdown: { channel: number; guild: number; global: number };
  embeddingCount: number;
}

export interface EvalErrorEntry {
  id: number;
  entityId: number;
  entityName: string | null;
  ownerId: string;
  errorMessage: string;
  condition: string | null;
  notifiedAt: string | null;
  createdAt: string;
}

export interface ActiveEffectEntry {
  id: number;
  entityId: number;
  content: string;
  source: string | null;
  expiresAt: string;
  remainingMs: number;
  createdAt: string;
}

export interface MessageStats {
  channelId: string;
  totalMessages: number;
  postForgetCount: number;
  forgetTime: string | null;
  authorBreakdown: { name: string; count: number }[];
}

// =============================================================================
// Functions
// =============================================================================

export function getBindingGraph(guildId?: string, channelId?: string): BindingGraph {
  const db = getDb();

  let query = `SELECT * FROM discord_entities`;
  const params: string[] = [];
  const clauses: string[] = [];

  if (guildId) {
    clauses.push(`(discord_id = ? OR scope_guild_id = ?)`);
    params.push(guildId, guildId);
  }
  if (channelId) {
    clauses.push(`(discord_id = ? OR scope_channel_id = ?)`);
    params.push(channelId, channelId);
  }

  if (clauses.length > 0) {
    query += ` WHERE ${clauses.join(" AND ")}`;
  }
  query += ` ORDER BY discord_type, discord_id`;

  const rows = db.prepare(query).all(...params) as {
    id: number;
    discord_id: string;
    discord_type: string;
    scope_guild_id: string | null;
    scope_channel_id: string | null;
    entity_id: number;
  }[];

  const bindings: BindingEntry[] = rows.map(r => {
    const entity = getEntity(r.entity_id);
    return {
      id: r.id,
      discordId: r.discord_id,
      discordType: r.discord_type,
      scopeGuildId: r.scope_guild_id,
      scopeChannelId: r.scope_channel_id,
      entityId: r.entity_id,
      entityName: entity?.name ?? null,
    };
  });

  return { bindings, total: bindings.length };
}

export function getMemoryStats(entityId: number): MemoryStats {
  const db = getDb();
  const memories = getMemoriesForEntity(entityId);

  let frecency: MemoryStats["frecency"] = null;
  if (memories.length > 0) {
    const values = memories.map(m => m.frecency);
    frecency = {
      min: Math.min(...values),
      max: Math.max(...values),
      mean: values.reduce((a, b) => a + b, 0) / values.length,
    };
  }

  // Scope breakdown
  let channel = 0;
  let guild = 0;
  let global = 0;
  for (const m of memories) {
    if (m.source_channel_id) channel++;
    else if (m.source_guild_id) guild++;
    else global++;
  }

  // Embedding count
  const memoryIds = memories.map(m => m.id);
  let embeddingCount = 0;
  if (memoryIds.length > 0) {
    const placeholders = memoryIds.map(() => "?").join(",");
    const row = db.prepare(
      `SELECT COUNT(*) as count FROM memory_embeddings WHERE memory_id IN (${placeholders})`
    ).get(...memoryIds) as { count: number };
    embeddingCount = row.count;
  }

  return {
    entityId,
    total: memories.length,
    frecency,
    scopeBreakdown: { channel, guild, global },
    embeddingCount,
  };
}

export function getEvalErrors(entityId?: number, limit = 50): EvalErrorEntry[] {
  const db = getDb();

  let query = `SELECT * FROM eval_errors`;
  const params: (number | string)[] = [];

  if (entityId !== undefined) {
    query += ` WHERE entity_id = ?`;
    params.push(entityId);
  }
  query += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(query).all(...params) as {
    id: number;
    entity_id: number;
    owner_id: string;
    error_message: string;
    condition: string | null;
    notified_at: string | null;
    created_at: string;
  }[];

  return rows.map(r => {
    const entity = getEntity(r.entity_id);
    return {
      id: r.id,
      entityId: r.entity_id,
      entityName: entity?.name ?? null,
      ownerId: r.owner_id,
      errorMessage: r.error_message,
      condition: r.condition,
      notifiedAt: r.notified_at,
      createdAt: r.created_at,
    };
  });
}

export function getActiveEffectsDebug(entityId: number): ActiveEffectEntry[] {
  const effects = getActiveEffects(entityId);
  const now = Date.now();

  return effects.map(e => ({
    id: e.id,
    entityId: e.entity_id,
    content: e.content,
    source: e.source,
    expiresAt: e.expires_at,
    remainingMs: Math.max(0, new Date(e.expires_at).getTime() - now),
    createdAt: e.created_at,
  }));
}

export function getMessageStats(channelId: string): MessageStats {
  const db = getDb();
  const forgetTime = getChannelForgetTime(channelId);

  // Total messages
  const totalRow = db.prepare(
    `SELECT COUNT(*) as count FROM messages WHERE channel_id = ?`
  ).get(channelId) as { count: number };

  // Post-forget count
  let postForgetCount = totalRow.count;
  if (forgetTime) {
    const postRow = db.prepare(
      `SELECT COUNT(*) as count FROM messages WHERE channel_id = ? AND created_at > ?`
    ).get(channelId, forgetTime) as { count: number };
    postForgetCount = postRow.count;
  }

  // Author breakdown
  const authorRows = db.prepare(`
    SELECT author_name as name, COUNT(*) as count
    FROM messages WHERE channel_id = ?
    GROUP BY author_name ORDER BY count DESC LIMIT 20
  `).all(channelId) as { name: string; count: number }[];

  return {
    channelId,
    totalMessages: totalRow.count,
    postForgetCount,
    forgetTime,
    authorBreakdown: authorRows,
  };
}
