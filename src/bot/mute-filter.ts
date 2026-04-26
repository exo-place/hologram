import { isMuted } from "../db/moderation";
import type { EntityWithFacts } from "../db/entities";

export interface MuteFilterResult {
  active: EntityWithFacts[];
  /** Entities dropped and why (entity name → scope that fired) */
  muted: { entity: EntityWithFacts; scope: string }[];
}

/**
 * Filter entities through active mutes.
 *
 * Check order per entity (first match wins):
 * 1. Channel kill-switch: scope_type='channel', scope_id=channelId
 * 2. Guild kill-switch: scope_type='guild', scope_id=guildId
 * 3. Owner mute: scope_type='owner', scope_id=entity.owned_by
 * 4. Entity mute: scope_type='entity', scope_id=String(entity.id)
 *
 * Kill-switches (channel/guild) are checked once and apply to all entities.
 * Returns empty active list if the channel or guild is muted.
 */
export function filterMutedEntities(
  entities: EntityWithFacts[],
  channelId: string | null,
  guildId: string | null,
): MuteFilterResult {
  if (entities.length === 0) return { active: [], muted: [] };

  // Channel kill-switch: if this channel is muted, no entity responds
  if (channelId) {
    const channelMute = isMuted("channel", channelId, channelId, guildId);
    if (channelMute) {
      return {
        active: [],
        muted: entities.map(e => ({ entity: e, scope: "channel" })),
      };
    }
  }

  // Guild kill-switch: if this guild is muted, no entity responds
  if (guildId) {
    const guildMute = isMuted("guild", guildId, null, null);
    if (guildMute) {
      return {
        active: [],
        muted: entities.map(e => ({ entity: e, scope: "guild" })),
      };
    }
  }

  const active: EntityWithFacts[] = [];
  const muted: { entity: EntityWithFacts; scope: string }[] = [];

  for (const entity of entities) {
    // Per-owner mute
    if (entity.owned_by) {
      const ownerMute = isMuted("owner", entity.owned_by, channelId, guildId);
      if (ownerMute) {
        muted.push({ entity, scope: "owner" });
        continue;
      }
    }

    // Per-entity mute
    const entityMute = isMuted("entity", String(entity.id), channelId, guildId);
    if (entityMute) {
      muted.push({ entity, scope: "entity" });
      continue;
    }

    active.push(entity);
  }

  return { active, muted };
}
