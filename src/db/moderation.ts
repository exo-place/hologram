import { getDb } from "./index";

// =============================================================================
// Entity Events (rate-limit sliding window + audit source of truth)
// =============================================================================

export type TriggerType = "message" | "tick" | "retry" | "trigger_tool" | "slash_trigger" | "web";

export interface EntityEvent {
  id: number;
  entity_id: number;
  owner_id: string | null;
  channel_id: string;
  guild_id: string | null;
  trigger_type: TriggerType;
  created_at: string;
}

export function recordEntityEvent(
  entityId: number,
  ownerId: string | null,
  channelId: string,
  guildId: string | null,
  triggerType: TriggerType
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO entity_events (entity_id, owner_id, channel_id, guild_id, trigger_type)
    VALUES (?, ?, ?, ?, ?)
  `).run(entityId, ownerId ?? null, channelId, guildId ?? null, triggerType);
}

/** Count entity events for a specific entity in the last windowSecs seconds. */
export function countEntityEvents(entityId: number, windowSecs = 60): number {
  const db = getDb();
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM entity_events
    WHERE entity_id = ? AND created_at >= datetime('now', ? || ' seconds')
  `).get(entityId, `-${windowSecs}`) as { count: number };
  return row.count;
}

/** Count entity events for a specific owner within a guild in the last windowSecs seconds. */
export function countOwnerEvents(ownerId: string, guildId: string | null, windowSecs = 60): number {
  const db = getDb();
  if (guildId) {
    const row = db.prepare(`
      SELECT COUNT(*) as count FROM entity_events
      WHERE owner_id = ? AND guild_id = ? AND created_at >= datetime('now', ? || ' seconds')
    `).get(ownerId, guildId, `-${windowSecs}`) as { count: number };
    return row.count;
  }
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM entity_events
    WHERE owner_id = ? AND created_at >= datetime('now', ? || ' seconds')
  `).get(ownerId, `-${windowSecs}`) as { count: number };
  return row.count;
}

/** Count entity events for a specific channel in the last windowSecs seconds. */
export function countChannelEvents(channelId: string, windowSecs = 60): number {
  const db = getDb();
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM entity_events
    WHERE channel_id = ? AND created_at >= datetime('now', ? || ' seconds')
  `).get(channelId, `-${windowSecs}`) as { count: number };
  return row.count;
}

/** Delete entity_events older than retentionDays (default 7). Called at startup. */
export function gcOldEvents(retentionDays = 7): number {
  const db = getDb();
  const result = db.prepare(`
    DELETE FROM entity_events WHERE created_at < datetime('now', ? || ' days')
  `).run(`-${retentionDays}`);
  return result.changes;
}

// =============================================================================
// Entity Mutes
// =============================================================================

export type MuteScopeType = "entity" | "owner" | "channel" | "guild";

export interface EntityMute {
  id: number;
  scope_type: MuteScopeType;
  scope_id: string;
  guild_id: string | null;
  channel_id: string | null;
  expires_at: string | null;
  created_by: string;
  reason: string | null;
  created_at: string;
}

export interface AddMuteParams {
  scope_type: MuteScopeType;
  scope_id: string;
  guild_id?: string | null;
  channel_id?: string | null;
  expires_at?: string | null;
  created_by: string;
  reason?: string | null;
}

export function addMute(params: AddMuteParams): EntityMute {
  const db = getDb();
  return db.prepare(`
    INSERT INTO entity_mutes (scope_type, scope_id, guild_id, channel_id, expires_at, created_by, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(
    params.scope_type,
    params.scope_id,
    params.guild_id ?? null,
    params.channel_id ?? null,
    params.expires_at ?? null,
    params.created_by,
    params.reason ?? null,
  ) as EntityMute;
}

export function removeMute(id: number): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM entity_mutes WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function getMute(id: number): EntityMute | null {
  const db = getDb();
  return db.prepare(`SELECT * FROM entity_mutes WHERE id = ?`).get(id) as EntityMute | null;
}

export interface ListMutesFilter {
  scope_type?: MuteScopeType;
  scope_id?: string;
  guild_id?: string | null;
  channel_id?: string | null;
  includeExpired?: boolean;
}

export function listActiveMutes(filter: ListMutesFilter = {}): EntityMute[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: (string | null)[] = [];

  if (!filter.includeExpired) {
    conditions.push(`(expires_at IS NULL OR expires_at > datetime('now'))`);
  }
  if (filter.scope_type !== undefined) {
    conditions.push(`scope_type = ?`);
    params.push(filter.scope_type);
  }
  if (filter.scope_id !== undefined) {
    conditions.push(`scope_id = ?`);
    params.push(filter.scope_id);
  }
  if (filter.guild_id !== undefined) {
    if (filter.guild_id === null) {
      conditions.push(`guild_id IS NULL`);
    } else {
      conditions.push(`guild_id = ?`);
      params.push(filter.guild_id);
    }
  }
  if (filter.channel_id !== undefined) {
    if (filter.channel_id === null) {
      conditions.push(`channel_id IS NULL`);
    } else {
      conditions.push(`channel_id = ?`);
      params.push(filter.channel_id);
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return db.prepare(`SELECT * FROM entity_mutes ${where} ORDER BY created_at DESC`).all(...params) as EntityMute[];
}

/**
 * Check if a scope_id is muted at the given channel/guild location.
 * A mute matches if its (channel_id, guild_id) scope contains the request's location.
 *
 * Scope matching rules:
 * - mute.channel_id=set, mute.guild_id=set  → only that channel in that guild
 * - mute.channel_id=NULL, mute.guild_id=set → all channels in that guild
 * - mute.channel_id=NULL, mute.guild_id=NULL → everywhere (global)
 */
export function isMuted(
  scope_type: MuteScopeType,
  scope_id: string,
  channelId: string | null,
  guildId: string | null
): EntityMute | null {
  const db = getDb();

  // Build scope-matching WHERE clause
  const scopeParts: string[] = [];

  // Global mutes always match
  scopeParts.push(`(guild_id IS NULL AND channel_id IS NULL)`);

  // Guild-wide mutes match if guild matches
  if (guildId) {
    scopeParts.push(`(guild_id = ? AND channel_id IS NULL)`);
  }

  // Channel-specific mutes match if both channel and guild match
  if (channelId && guildId) {
    scopeParts.push(`(guild_id = ? AND channel_id = ?)`);
  } else if (channelId) {
    // DM / web channels: match on channel_id only when no guild
    scopeParts.push(`(guild_id IS NULL AND channel_id = ?)`);
  }

  const params: (string | null)[] = [scope_type, scope_id];
  if (guildId) params.push(guildId);
  if (channelId && guildId) { params.push(guildId); params.push(channelId); }
  else if (channelId) params.push(channelId);

  const scopeWhere = scopeParts.join(" OR ");

  return db.prepare(`
    SELECT * FROM entity_mutes
    WHERE scope_type = ? AND scope_id = ?
      AND (expires_at IS NULL OR expires_at > datetime('now'))
      AND (${scopeWhere})
    ORDER BY created_at DESC
    LIMIT 1
  `).get(...params) as EntityMute | null;
}

/** Remove expired mutes (for periodic cleanup). */
export function gcExpiredMutes(): number {
  const db = getDb();
  const result = db.prepare(`
    DELETE FROM entity_mutes WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')
  `).run();
  return result.changes;
}

// =============================================================================
// Mod Events (audit log)
// =============================================================================

export type ModEventType =
  | "rate_limited"
  | "muted"
  | "unmuted"
  | "channel_disabled"
  | "channel_enabled"
  | "guild_disabled"
  | "guild_enabled"
  | "config_changed"
  | "delete_message";

export interface ModEvent {
  id: number;
  event_type: ModEventType;
  actor_id: string | null;
  target_type: string | null;
  target_id: string | null;
  channel_id: string | null;
  guild_id: string | null;
  details: string | null;
  created_at: string;
}

export interface RecordModEventParams {
  event_type: ModEventType;
  actor_id?: string | null;
  target_type?: string | null;
  target_id?: string | null;
  channel_id?: string | null;
  guild_id?: string | null;
  details?: Record<string, unknown> | null;
}

export function recordModEvent(params: RecordModEventParams): ModEvent {
  const db = getDb();
  return db.prepare(`
    INSERT INTO mod_events (event_type, actor_id, target_type, target_id, channel_id, guild_id, details)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(
    params.event_type,
    params.actor_id ?? null,
    params.target_type ?? null,
    params.target_id ?? null,
    params.channel_id ?? null,
    params.guild_id ?? null,
    params.details ? JSON.stringify(params.details) : null,
  ) as ModEvent;
}

export interface GetModEventsFilter {
  guild_id?: string;
  channel_id?: string;
  target_type?: string;
  target_id?: string;
  event_type?: ModEventType;
  hours?: number;
  limit?: number;
}

export function getModEvents(filter: GetModEventsFilter = {}): ModEvent[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filter.guild_id) { conditions.push(`guild_id = ?`); params.push(filter.guild_id); }
  if (filter.channel_id) { conditions.push(`channel_id = ?`); params.push(filter.channel_id); }
  if (filter.target_type) { conditions.push(`target_type = ?`); params.push(filter.target_type); }
  if (filter.target_id) { conditions.push(`target_id = ?`); params.push(filter.target_id); }
  if (filter.event_type) { conditions.push(`event_type = ?`); params.push(filter.event_type); }
  if (filter.hours) {
    conditions.push(`created_at >= datetime('now', ? || ' hours')`);
    params.push(`-${filter.hours}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filter.limit ?? 100;
  params.push(limit);

  return db.prepare(`SELECT * FROM mod_events ${where} ORDER BY created_at DESC LIMIT ?`).all(...params) as ModEvent[];
}
