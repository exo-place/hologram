import type { EntityWithFacts } from "../../db/entities";
import { getPermissionDefaults } from "../../db/entities";
import { parsePermissionDirectives, matchesUserEntry, isUserBlacklisted, isUserAllowed } from "../../logic/expr";
import { resolveDiscordConfig } from "../../db/discord";

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
