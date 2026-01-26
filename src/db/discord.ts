import { getDb } from "./index";

// =============================================================================
// Discord Entity Mapping
// =============================================================================

export type DiscordType = "user" | "channel" | "guild";

export interface DiscordEntityMapping {
  id: number;
  discord_id: string;
  discord_type: DiscordType;
  scope_guild_id: string | null;
  scope_channel_id: string | null;
  entity_id: number;
}

/**
 * Map a Discord ID to an entity with optional scope.
 * Scope resolution order (most specific wins):
 * 1. channel-scoped (user_id + channel_id)
 * 2. guild-scoped (user_id + guild_id)
 * 3. global (user_id only)
 */
export function setDiscordEntity(
  discordId: string,
  discordType: DiscordType,
  entityId: number,
  scopeGuildId?: string,
  scopeChannelId?: string
): DiscordEntityMapping {
  const db = getDb();
  return db.prepare(`
    INSERT INTO discord_entities (discord_id, discord_type, scope_guild_id, scope_channel_id, entity_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (discord_id, discord_type, scope_guild_id, scope_channel_id)
    DO UPDATE SET entity_id = excluded.entity_id
    RETURNING *
  `).get(
    discordId,
    discordType,
    scopeGuildId ?? null,
    scopeChannelId ?? null,
    entityId
  ) as DiscordEntityMapping;
}

/**
 * Resolve a Discord ID to an entity, respecting scope precedence.
 */
export function resolveDiscordEntity(
  discordId: string,
  discordType: DiscordType,
  guildId?: string,
  channelId?: string
): number | null {
  const db = getDb();

  // Try channel-scoped first
  if (channelId) {
    const channelScoped = db.prepare(`
      SELECT entity_id FROM discord_entities
      WHERE discord_id = ? AND discord_type = ? AND scope_channel_id = ?
    `).get(discordId, discordType, channelId) as { entity_id: number } | null;
    if (channelScoped) return channelScoped.entity_id;
  }

  // Try guild-scoped
  if (guildId) {
    const guildScoped = db.prepare(`
      SELECT entity_id FROM discord_entities
      WHERE discord_id = ? AND discord_type = ? AND scope_guild_id = ? AND scope_channel_id IS NULL
    `).get(discordId, discordType, guildId) as { entity_id: number } | null;
    if (guildScoped) return guildScoped.entity_id;
  }

  // Try global
  const global = db.prepare(`
    SELECT entity_id FROM discord_entities
    WHERE discord_id = ? AND discord_type = ? AND scope_guild_id IS NULL AND scope_channel_id IS NULL
  `).get(discordId, discordType) as { entity_id: number } | null;
  return global?.entity_id ?? null;
}

/**
 * Remove a Discord entity mapping.
 */
export function removeDiscordEntity(
  discordId: string,
  discordType: DiscordType,
  scopeGuildId?: string,
  scopeChannelId?: string
): boolean {
  const db = getDb();

  let query = `DELETE FROM discord_entities WHERE discord_id = ? AND discord_type = ?`;
  const params: (string | null)[] = [discordId, discordType];

  if (scopeChannelId) {
    query += ` AND scope_channel_id = ?`;
    params.push(scopeChannelId);
  } else {
    query += ` AND scope_channel_id IS NULL`;
  }

  if (scopeGuildId) {
    query += ` AND scope_guild_id = ?`;
    params.push(scopeGuildId);
  } else {
    query += ` AND scope_guild_id IS NULL`;
  }

  const result = db.prepare(query).run(...params);
  return result.changes > 0;
}

/**
 * List all mappings for a Discord ID.
 */
export function listDiscordMappings(
  discordId: string,
  discordType: DiscordType
): DiscordEntityMapping[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM discord_entities
    WHERE discord_id = ? AND discord_type = ?
  `).all(discordId, discordType) as DiscordEntityMapping[];
}

// =============================================================================
// Message History
// =============================================================================

export interface Message {
  id: number;
  channel_id: string;
  author_id: string;
  author_name: string;
  content: string;
  created_at: string;
}

export function addMessage(
  channelId: string,
  authorId: string,
  authorName: string,
  content: string
): Message {
  const db = getDb();
  return db.prepare(`
    INSERT INTO messages (channel_id, author_id, author_name, content)
    VALUES (?, ?, ?, ?)
    RETURNING *
  `).get(channelId, authorId, authorName, content) as Message;
}

export function getMessages(channelId: string, limit = 50): Message[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM messages
    WHERE channel_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(channelId, limit) as Message[];
}

export function clearMessages(channelId: string): number {
  const db = getDb();
  const result = db.prepare(`DELETE FROM messages WHERE channel_id = ?`).run(channelId);
  return result.changes;
}

// =============================================================================
// Context Building
// =============================================================================

export function formatMessagesForContext(messages: Message[]): string {
  // Messages come in DESC order, reverse for chronological
  return messages
    .slice()
    .reverse()
    .map(m => `${m.author_name}: ${m.content}`)
    .join("\n");
}
