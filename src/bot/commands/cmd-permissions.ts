import type { EntityWithFacts } from "../../db/entities";
import { getPermissionDefaults } from "../../db/entities";
import { parsePermissionDirectives, matchesUserEntry, isUserBlacklisted, isUserAllowed } from "../../logic/expr";
import { resolveDiscordConfig } from "../../db/discord";
import { warn } from "../../logger";
import { calculateBits } from "@discordeno/utils";
import type { PermissionStrings } from "@discordeno/types";

// =============================================================================
// Discord Channel Access Check (confused-deputy prevention)
// =============================================================================

/** Minimal bot-helpers interface for the channel access check. */
export interface ChannelCheckBot {
  helpers: {
    getMember(guildId: bigint, userId: bigint): Promise<{ roles?: bigint[] }>;
    getChannel(channelId: bigint): Promise<{
      permissionOverwrites?: Array<{
        id: bigint;
        type?: number;
        allow?: PermissionStrings[] | bigint | { bitfield: bigint };
        deny?: PermissionStrings[] | bigint | { bitfield: bigint };
      }>;
    }>;
    getRoles(guildId: bigint): Promise<Array<{
      id: bigint;
      permissions?: PermissionStrings[] | bigint | { bitfield: bigint };
    }>>;
  };
}

const VIEW_CHANNEL = 1n << 10n;
const READ_MESSAGE_HISTORY = 1n << 16n;
const ADMINISTRATOR = 1n << 3n;

// Cache: key = `${ownerId}:${channelId}`, value: {result, expiry}
const _ownerChannelCache = new Map<string, { result: boolean; expiry: number }>();
const CACHE_TTL_MS = 30_000;

/** Flush the owner-channel access cache (e.g. after permission changes). */
export function clearOwnerChannelCache(): void {
  _ownerChannelCache.clear();
}

/** Convert a PermissionStrings[], Permissions class, or raw bigint to a BigInt bitmask. */
function permsToBigInt(v: PermissionStrings[] | { bitfield: bigint } | bigint | undefined | null): bigint {
  if (v == null) return 0n;
  if (typeof v === "bigint") return v;
  if (typeof v === "object" && !Array.isArray(v) && "bitfield" in v) return v.bitfield;
  if (Array.isArray(v)) return BigInt(calculateBits(v as PermissionStrings[]));
  return 0n;
}

/**
 * Check whether the entity owner has VIEW_CHANNEL + READ_MESSAGE_HISTORY on a Discord channel.
 * Prevents the confused-deputy attack where a server-bound entity leaks private-channel
 * content to an owner who cannot read that channel.
 *
 * Returns true for DM channels (no permission model) and on API errors (fail open).
 * The bot owner is not exempt here — entity owners must have explicit channel access.
 */
export async function canOwnerReadChannel(
  bot: ChannelCheckBot,
  ownerDiscordId: string,
  guildId: bigint,
  channelId: bigint,
): Promise<boolean> {
  const cacheKey = `${ownerDiscordId}:${channelId}`;
  const cached = _ownerChannelCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) return cached.result;

  let result = false;
  try {
    const ownerIdBig = BigInt(ownerDiscordId);

    const [member, channel, roles] = await Promise.all([
      bot.helpers.getMember(guildId, ownerIdBig),
      bot.helpers.getChannel(channelId),
      bot.helpers.getRoles(guildId),
    ]);

    const memberRoles: bigint[] = member.roles ?? [];
    const overwrites = channel.permissionOverwrites ?? [];

    // Base: @everyone role permissions (role whose id === guildId)
    const everyoneRole = roles.find(r => r.id === guildId);
    let perms = permsToBigInt(everyoneRole?.permissions);

    // OR in all member role permissions
    for (const roleId of memberRoles) {
      const role = roles.find(r => r.id === roleId);
      if (role) perms |= permsToBigInt(role.permissions);
    }

    // Administrator bypasses all channel restrictions
    if ((perms & ADMINISTRATOR) === ADMINISTRATOR) {
      result = true;
    } else {
      // Apply @everyone channel overwrite
      const everyoneOw = overwrites.find(o => o.id === guildId);
      if (everyoneOw) {
        perms &= ~permsToBigInt(everyoneOw.deny);
        perms |= permsToBigInt(everyoneOw.allow);
      }

      // Apply role overwrites (collect all denies, then all allows)
      let roleAllow = 0n;
      let roleDeny = 0n;
      for (const ow of overwrites) {
        if (memberRoles.some(r => r === ow.id)) {
          roleDeny |= permsToBigInt(ow.deny);
          roleAllow |= permsToBigInt(ow.allow);
        }
      }
      perms &= ~roleDeny;
      perms |= roleAllow;

      // Apply member-specific overwrite
      const memberOw = overwrites.find(o => o.id === ownerIdBig);
      if (memberOw) {
        perms &= ~permsToBigInt(memberOw.deny);
        perms |= permsToBigInt(memberOw.allow);
      }

      result =
        (perms & VIEW_CHANNEL) === VIEW_CHANNEL &&
        (perms & READ_MESSAGE_HISTORY) === READ_MESSAGE_HISTORY;
    }
  } catch (err) {
    // Fail open: if the Discord API is unavailable, don't silently block the entity
    warn("canOwnerReadChannel: API error, defaulting to allow", {
      ownerDiscordId,
      guildId: guildId.toString(),
      channelId: channelId.toString(),
      err,
    });
    result = true;
  }

  _ownerChannelCache.set(cacheKey, { result, expiry: Date.now() + CACHE_TTL_MS });
  return result;
}

/**
 * Check if a user can edit an entity.
 * Owner always can. Blacklist blocks everyone except owner.
 * Otherwise check $edit directive. Default = owner-only.
 */
export function canUserEdit(entity: EntityWithFacts, userId: string, username: string, userRoles: string[] = []): boolean {
  // Owner always can
  if (entity.owned_by === userId) return true;

  // Parse permission directives from config columns + raw facts
  const facts = entity.facts.map(f => f.content);
  const permissions = parsePermissionDirectives(facts, getPermissionDefaults(entity.id));

  // Check blacklist first (deny overrides allow)
  if (isUserBlacklisted(permissions, userId, username, entity.owned_by, userRoles)) return false;

  // Check $edit directive (supports both usernames, Discord IDs, and role IDs)
  if (permissions.editList === "@everyone") return true;
  if (permissions.editList && permissions.editList.some(u => matchesUserEntry(u, userId, username, userRoles))) return true;

  // No $edit directive = owner only
  return false;
}

/**
 * Check if a user can view an entity.
 * Owner always can. Blacklist blocks everyone except owner.
 * Otherwise check $view directive. Default = owner-only.
 */
export function canUserView(entity: EntityWithFacts, userId: string, username: string, userRoles: string[] = []): boolean {
  // Owner always can
  if (entity.owned_by === userId) return true;

  // Parse permission directives from config columns + raw facts
  const facts = entity.facts.map(f => f.content);
  const permissions = parsePermissionDirectives(facts, getPermissionDefaults(entity.id));

  // Check blacklist first (deny overrides allow)
  if (isUserBlacklisted(permissions, userId, username, entity.owned_by, userRoles)) return false;

  // If no $view directive, default to owner-only
  if (permissions.viewList === null) return false;

  // Check $view directive (supports both usernames, Discord IDs, and role IDs)
  if (permissions.viewList === "@everyone") return true;
  if (permissions.viewList.some(u => matchesUserEntry(u, userId, username, userRoles))) return true;

  return false;
}

/**
 * Check if a user can delete messages sent by an entity.
 * Owner always can. Default (no $delete directive) = owner + Manage Webhooks only.
 * Bot-owner-level access is checked separately in the command handler.
 */
export function canUserDelete(entity: EntityWithFacts, userId: string, username: string, userRoles: string[] = []): boolean {
  if (entity.owned_by === userId) return true;
  const facts = entity.facts.map(f => f.content);
  const permissions = parsePermissionDirectives(facts, getPermissionDefaults(entity.id));
  if (isUserBlacklisted(permissions, userId, username, entity.owned_by, userRoles)) return false;
  // No $delete directive = owner-only (not @everyone default)
  if (!permissions.deleteList) return false;
  if (permissions.deleteList === "@everyone") return true;
  return permissions.deleteList.some(u => matchesUserEntry(u, userId, username, userRoles));
}

/**
 * Check if a user can use an entity (persona / trigger permission).
 * Owner always can. Blacklist blocks everyone except owner.
 * Otherwise check $use directive. Default = everyone.
 */
export function canUserUse(entity: EntityWithFacts, userId: string, username: string, userRoles: string[] = []): boolean {
  if (entity.owned_by === userId) return true;
  const facts = entity.facts.map(f => f.content);
  const permissions = parsePermissionDirectives(facts, getPermissionDefaults(entity.id));
  if (isUserBlacklisted(permissions, userId, username, entity.owned_by, userRoles)) return false;
  return isUserAllowed(permissions, userId, username, entity.owned_by, userRoles);
}

/**
 * Check if a user can bind entities in a location (server-side check).
 * Uses resolveDiscordConfig for channel > guild > default precedence.
 */
export function canUserBindInLocation(userId: string, username: string, userRoles: string[], channelId?: string, guildId?: string): boolean {
  const config = resolveDiscordConfig(channelId, guildId);

  // Check blacklist first (deny overrides allow)
  if (config.blacklist?.some(entry => matchesUserEntry(entry, userId, username, userRoles))) return false;

  // No bind restriction = everyone allowed
  if (!config.bind) return true;

  // Check allowlist
  return config.bind.some(entry => matchesUserEntry(entry, userId, username, userRoles));
}

/**
 * Check if a user can use personas in a location (server-side check).
 * Uses resolveDiscordConfig for channel > guild > default precedence.
 */
export function canUserPersonaInLocation(userId: string, username: string, userRoles: string[], channelId?: string, guildId?: string): boolean {
  const config = resolveDiscordConfig(channelId, guildId);

  // Check blacklist first (deny overrides allow)
  if (config.blacklist?.some(entry => matchesUserEntry(entry, userId, username, userRoles))) return false;

  // No persona restriction = everyone allowed
  if (!config.persona) return true;

  // Check allowlist
  return config.persona.some(entry => matchesUserEntry(entry, userId, username, userRoles));
}
