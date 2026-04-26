import type { EvaluatedEntity } from "../ai/context";
import { getEntityConfig } from "../db/entities";
import { getEntity } from "../db/entities";
import { resolveDiscordConfig } from "../db/discord";
import { countEntityEvents, countOwnerEvents, countChannelEvents, recordModEvent } from "../db/moderation";
import type { TriggerType } from "../db/moderation";
import { debug } from "../logger";

export type { TriggerType };

export interface DeniedEntity {
  entity: EvaluatedEntity;
  ownerId: string | null;
  scope: "entity" | "owner" | "channel";
  limit: number;
  current: number;
}

export interface RateLimitDecision {
  allow: EvaluatedEntity[];
  denied: DeniedEntity[];
  /** entityId → ownerId for allowed entities (used for recordEntityEvent after emit) */
  ownerIds: Map<number, string | null>;
}

/**
 * Check rate limits for a set of entities about to respond.
 *
 * Checks three scopes in order, all must pass:
 * 1. Per-entity (entities.config_rate_per_min)
 * 2. Per-owner (discord_config.config_rate_owner_per_min, channel→guild precedence)
 * 3. Per-channel (discord_config.config_rate_channel_per_min, channel→guild precedence)
 *
 * Resolves discord config once per call (not per entity) since channel/owner limits are shared.
 * Returns allowed entities, denied details, and owner ID map for the allow set.
 */
export function checkRateLimits(
  channelId: string,
  guildId: string | undefined,
  entities: EvaluatedEntity[]
): RateLimitDecision {
  if (entities.length === 0) return { allow: [], denied: [], ownerIds: new Map() };

  const resolved = resolveDiscordConfig(channelId, guildId);
  const channelLimit = resolved.rateChannel;
  const ownerLimit = resolved.rateOwner;

  // Cache sliding-window counts to avoid redundant DB queries for shared scopes.
  // Channel count is the same for all entities; owner count is shared per ownerId.
  let cachedChannelCount: number | null = null;
  const ownerCountCache = new Map<string, number>();

  const allow: EvaluatedEntity[] = [];
  const denied: DeniedEntity[] = [];
  const ownerIds = new Map<number, string | null>();

  for (const entity of entities) {
    const config = getEntityConfig(entity.id);
    const entityRow = getEntity(entity.id);
    const ownerId = entityRow?.owned_by ?? null;

    // 1. Per-entity limit
    const entityLimit = config?.config_rate_per_min ?? null;
    if (entityLimit !== null) {
      const current = countEntityEvents(entity.id, 60);
      if (current >= entityLimit) {
        denied.push({ entity, ownerId, scope: "entity", limit: entityLimit, current });
        recordModEvent({
          event_type: "rate_limited",
          target_type: "entity",
          target_id: String(entity.id),
          channel_id: channelId,
          guild_id: guildId ?? null,
          details: { scope: "entity", limit: entityLimit, current, entity_name: entity.name },
        });
        debug("Rate limit: entity", { entity: entity.name, limit: entityLimit, current });
        continue;
      }
    }

    // 2. Per-owner limit
    if (ownerLimit !== null && ownerId) {
      let current = ownerCountCache.get(ownerId);
      if (current === undefined) {
        current = countOwnerEvents(ownerId, guildId ?? null, 60);
        ownerCountCache.set(ownerId, current);
      }
      if (current >= ownerLimit) {
        denied.push({ entity, ownerId, scope: "owner", limit: ownerLimit, current });
        recordModEvent({
          event_type: "rate_limited",
          target_type: "entity",
          target_id: String(entity.id),
          channel_id: channelId,
          guild_id: guildId ?? null,
          details: { scope: "owner", limit: ownerLimit, current, entity_name: entity.name, owner_id: ownerId },
        });
        debug("Rate limit: owner", { entity: entity.name, ownerId, limit: ownerLimit, current });
        continue;
      }
    }

    // 3. Per-channel limit
    if (channelLimit !== null) {
      if (cachedChannelCount === null) {
        cachedChannelCount = countChannelEvents(channelId, 60);
      }
      if (cachedChannelCount >= channelLimit) {
        denied.push({ entity, ownerId, scope: "channel", limit: channelLimit, current: cachedChannelCount });
        recordModEvent({
          event_type: "rate_limited",
          target_type: "entity",
          target_id: String(entity.id),
          channel_id: channelId,
          guild_id: guildId ?? null,
          details: { scope: "channel", limit: channelLimit, current: cachedChannelCount, entity_name: entity.name },
        });
        debug("Rate limit: channel", { entity: entity.name, limit: channelLimit, current: cachedChannelCount });
        continue;
      }
    }

    allow.push(entity);
    ownerIds.set(entity.id, ownerId);
  }

  return { allow, denied, ownerIds };
}

// =============================================================================
// Warn dedup (1× per (entityId, scope) per 5 min)
// =============================================================================

const WARN_TTL_MS = 5 * 60 * 1000;
const recentWarns = new Map<string, number>();

function warnKey(entityId: number, scope: string): string {
  return `${entityId}:${scope}`;
}

/** Returns true if a warn DM should be sent for this (entityId, scope) pair. Marks as warned. */
export function shouldWarnRateLimit(entityId: number, scope: string): boolean {
  const key = warnKey(entityId, scope);
  const last = recentWarns.get(key);
  const now = Date.now();
  if (last !== undefined && now - last < WARN_TTL_MS) return false;
  recentWarns.set(key, now);
  return true;
}

/** Evict stale warn entries (call periodically or after a batch). */
export function gcRateLimitWarns(): void {
  const now = Date.now();
  for (const [key, ts] of recentWarns) {
    if (now - ts >= WARN_TTL_MS) recentWarns.delete(key);
  }
}
