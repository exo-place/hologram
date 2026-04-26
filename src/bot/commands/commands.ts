import { ApplicationCommandOptionTypes, TextStyles, MessageComponentTypes } from "@discordeno/bot";
import {
  registerCommand,
  registerModalHandler,
  respond,
  respondWithModal,
  respondWithV2Modal,
} from "./index";
import {
  createEntity,
  getEntity,
  getEntityByName,
  getEntityWithFacts,
  getEntityWithFactsByName,
  deleteEntity,
  transferOwnership,
  addFact,
  type EntityWithFacts,
  getPermissionDefaults,
  getEntityEvalDefaults,
  setEntityConfig,
  safeParseFallback,
} from "../../db/entities";
import {
  getMemoriesForEntity,
} from "../../db/memories";
import {
  addDiscordEntity,
  removeDiscordEntityBinding,
  getMessages,
  setChannelForgetTime,
  getDiscordConfig,
  setDiscordConfig,
  deleteDiscordConfig,
  resolveDiscordConfig,
  formatMessagesForContext,
  getFilteredMessages,
  resolvePersona,
} from "../../db/discord";
import { parsePermissionDirectives, isUserBlacklisted, isUserAllowed, evaluateFacts, createBaseContext } from "../../logic/expr";
import { formatEntityDisplay } from "../../ai/context";
import { sendResponse } from "../client";
import { debug } from "../../logger";
import { elideText, buildDefaultValues, buildEntries, chunkContent, type ResolvedData } from "./helpers";
export { chunkContent, elideText, buildDefaultValues, buildEntries, type ResolvedData };
import { canUserEdit, canUserView, canUserUse, canUserDelete, canUserBindInLocation, canUserPersonaInLocation } from "./cmd-permissions";
export { canUserEdit, canUserView, canUserUse, canUserDelete, canUserBindInLocation, canUserPersonaInLocation };

// =============================================================================
// /create - Create entity
// =============================================================================

registerCommand({
  name: "create",
  description: "Create a new entity",
  noDefer: true,
  options: [
    {
      name: "name",
      description: "Name of the entity",
      type: ApplicationCommandOptionTypes.String,
      required: false,
    },
  ],
  async handler(ctx, options) {
    const name = options.name as string | undefined;

    if (name) {
      // Quick create with name
      const entity = createEntity(name, ctx.userId);
      // Set owner-only defaults for view and edit
      setEntityConfig(entity.id, {
        config_view: JSON.stringify([ctx.userId]),
        config_edit: JSON.stringify([ctx.userId]),
      });
      await respond(ctx.bot, ctx.interaction, `Created ${formatEntityDisplay(name, entity.id)}`, true);
    } else {
      // Open modal for details
      await respondWithModal(ctx.bot, ctx.interaction, "create", "Create entity", [
        {
          customId: "name",
          label: "Name",
          style: TextStyles.Short,
          required: true,
          placeholder: "Enter entity name",
        },
        {
          customId: "facts",
          label: "Facts (one per line)",
          style: TextStyles.Paragraph,
          required: false,
          placeholder: "Enter facts about this entity, one per line",
        },
      ]);
    }
  },
});

registerModalHandler("create", async (bot, interaction, values) => {
  const name = values.name;
  const factsText = values.facts ?? "";

  const userId = interaction.user?.id?.toString() ?? "";
  const entity = createEntity(name, userId);

  // Set owner-only defaults for view and edit
  setEntityConfig(entity.id, {
    config_view: JSON.stringify([userId]),
    config_edit: JSON.stringify([userId]),
  });

  // Add user-provided facts
  const facts = factsText.split("\n").map(f => f.trim()).filter(f => f);
  for (const fact of facts) {
    addFact(entity.id, fact);
  }

  await respond(bot, interaction, `Created ${formatEntityDisplay(name, entity.id)} with ${facts.length} facts`, true);
});

// =============================================================================
// /view - View entity
// =============================================================================

registerCommand({
  name: "view",
  description: "View an entity and its facts or memories",
  options: [
    {
      name: "entity",
      description: "Entity name or ID",
      type: ApplicationCommandOptionTypes.String,
      required: true,
      autocomplete: true,
    },
    {
      name: "type",
      description: "What to view (default: all)",
      type: ApplicationCommandOptionTypes.String,
      required: false,
      choices: [
        { name: "All (facts + memories)", value: "all" },
        { name: "Facts only", value: "facts" },
        { name: "Memories only", value: "memories" },
      ],
    },
  ],
  async handler(ctx, options) {
    const input = options.entity as string;
    const viewType = (options.type as string) ?? "all";

    // Try by ID first, then by name
    let entity: EntityWithFacts | null = null;
    const id = parseInt(input);
    if (!isNaN(id)) {
      entity = getEntityWithFacts(id);
    }
    if (!entity) {
      entity = getEntityWithFactsByName(input);
    }

    if (!entity) {
      await respond(ctx.bot, ctx.interaction, `Entity not found: ${input}`, true);
      return;
    }

    // Check view permission
    if (!canUserView(entity, ctx.userId, ctx.username, ctx.userRoles)) {
      await respond(ctx.bot, ctx.interaction, "You don't have permission to view this entity", true);
      return;
    }

    const parts: string[] = [formatEntityDisplay(entity.name, entity.id)];

    // Show facts if requested
    if (viewType === "all" || viewType === "facts") {
      const factsDisplay = entity.facts.length > 0
        ? entity.facts.map(f => `• ${f.content}`).join("\n")
        : "(no facts)";
      if (viewType === "all") {
        parts.push(`\n**Facts:**\n${factsDisplay}`);
      } else {
        parts.push(`\n${factsDisplay}`);
      }
    }

    // Show memories if requested
    if (viewType === "all" || viewType === "memories") {
      const memories = getMemoriesForEntity(entity.id);
      const memoriesDisplay = memories.length > 0
        ? memories.map(m => `• ${m.content} (frecency: ${m.frecency.toFixed(2)})`).join("\n")
        : "(no memories)";
      if (viewType === "all") {
        parts.push(`\n**Memories:**\n${memoriesDisplay}`);
      } else {
        parts.push(`\n${memoriesDisplay}`);
      }
    }

    await respond(ctx.bot, ctx.interaction, elideText(parts.join("")), true);
  },
});

// =============================================================================
// /delete - Delete entity
// =============================================================================

registerCommand({
  name: "delete",
  description: "Delete an entity (owner only)",
  options: [
    {
      name: "entity",
      description: "Entity name or ID",
      type: ApplicationCommandOptionTypes.String,
      required: true,
      autocomplete: true,
    },
  ],
  async handler(ctx, options) {
    const input = options.entity as string;

    let entity = null;
    const id = parseInt(input);
    if (!isNaN(id)) {
      entity = getEntity(id);
    }
    if (!entity) {
      entity = getEntityByName(input);
    }

    if (!entity) {
      await respond(ctx.bot, ctx.interaction, `Entity not found: ${input}`, true);
      return;
    }

    // Check ownership
    if (entity.owned_by !== ctx.userId) {
      await respond(ctx.bot, ctx.interaction, "You can only delete entities you own", true);
      return;
    }

    deleteEntity(entity.id);
    await respond(ctx.bot, ctx.interaction, `Deleted "${entity.name}"`, true);
  },
});

// =============================================================================
// /transfer - Transfer entity ownership
// =============================================================================

registerCommand({
  name: "transfer",
  description: "Transfer entity ownership to another user",
  options: [
    {
      name: "entity",
      description: "Entity name or ID",
      type: ApplicationCommandOptionTypes.String,
      required: true,
      autocomplete: true,
    },
    {
      name: "user",
      description: "User to transfer ownership to",
      type: ApplicationCommandOptionTypes.User,
      required: true,
    },
  ],
  async handler(ctx, options) {
    const input = options.entity as string;
    const newOwnerId = options.user as string;

    let entity = null;
    const id = parseInt(input);
    if (!isNaN(id)) {
      entity = getEntity(id);
    }
    if (!entity) {
      entity = getEntityByName(input);
    }

    if (!entity) {
      await respond(ctx.bot, ctx.interaction, `Entity not found: ${input}`, true);
      return;
    }

    // Only current owner can transfer
    if (entity.owned_by !== ctx.userId) {
      await respond(ctx.bot, ctx.interaction, "You can only transfer entities you own", true);
      return;
    }

    // Prevent transferring to self
    if (newOwnerId === ctx.userId) {
      await respond(ctx.bot, ctx.interaction, "You already own this entity", true);
      return;
    }

    transferOwnership(entity.id, newOwnerId);
    await respond(ctx.bot, ctx.interaction, `Transferred "${entity.name}" to <@${newOwnerId}>`, true);
  },
});

// =============================================================================
// /bind - Bind Discord thing to entity
// =============================================================================

registerCommand({
  name: "bind",
  description: "Bind a Discord channel, server, or user to an entity",
  options: [
    {
      name: "target",
      description: "What to bind",
      type: ApplicationCommandOptionTypes.String,
      required: true,
      choices: [
        { name: "This channel", value: "channel" },
        { name: "This server", value: "server" },
        { name: "Me (this channel)", value: "me:channel" },
        { name: "Me (this server)", value: "me:server" },
        { name: "Me (global)", value: "me:global" },
      ],
    },
    {
      name: "entity",
      description: "Entity name or ID to bind to",
      type: ApplicationCommandOptionTypes.String,
      required: true,
      autocomplete: true,
    },
  ],
  async handler(ctx, options) {
    const target = options.target as string;
    const entityInput = options.entity as string;

    // Find entity (need facts for permission checks)
    let entity: EntityWithFacts | null = null;
    const id = parseInt(entityInput);
    if (!isNaN(id)) {
      entity = getEntityWithFacts(id);
    }
    if (!entity) {
      entity = getEntityWithFactsByName(entityInput);
    }

    if (!entity) {
      await respond(ctx.bot, ctx.interaction, `Entity not found: ${entityInput}`, true);
      return;
    }

    const isPersonaBind = target.startsWith("me:");

    // Entity-side permission check
    if (isPersonaBind) {
      if (!canUserUse(entity, ctx.userId, ctx.username, ctx.userRoles)) {
        await respond(ctx.bot, ctx.interaction, "You don't have permission to use this entity as a persona", true);
        return;
      }
    } else {
      if (!canUserEdit(entity, ctx.userId, ctx.username, ctx.userRoles)) {
        await respond(ctx.bot, ctx.interaction, "You don't have permission to bind this entity", true);
        return;
      }
    }

    // Server-side permission check (skip for global persona — no location context)
    if (target !== "me:global") {
      if (isPersonaBind) {
        if (!canUserPersonaInLocation(ctx.userId, ctx.username, ctx.userRoles, ctx.channelId, ctx.guildId)) {
          await respond(ctx.bot, ctx.interaction, "You don't have permission to use personas here", true);
          return;
        }
      } else {
        if (!canUserBindInLocation(ctx.userId, ctx.username, ctx.userRoles, ctx.channelId, ctx.guildId)) {
          await respond(ctx.bot, ctx.interaction, "You don't have permission to bind entities here", true);
          return;
        }
      }
    }

    // Parse target into discordType and scope
    let discordId: string;
    let discordType: "user" | "channel" | "guild";
    let scopeGuildId: string | undefined;
    let scopeChannelId: string | undefined;
    let targetDesc: string;

    if (target === "channel") {
      discordId = ctx.channelId;
      discordType = "channel";
      targetDesc = "This channel";
    } else if (target === "server") {
      if (!ctx.guildId) {
        await respond(ctx.bot, ctx.interaction, "Cannot bind to server in DMs", true);
        return;
      }
      discordId = ctx.guildId;
      discordType = "guild";
      targetDesc = "This server";
    } else if (target === "me:channel") {
      discordId = ctx.userId;
      discordType = "user";
      scopeChannelId = ctx.channelId;
      targetDesc = "You (in this channel)";
    } else if (target === "me:server") {
      if (!ctx.guildId) {
        await respond(ctx.bot, ctx.interaction, "Cannot use server scope in DMs", true);
        return;
      }
      discordId = ctx.userId;
      discordType = "user";
      scopeGuildId = ctx.guildId;
      targetDesc = "You (in this server)";
    } else {
      // me:global
      discordId = ctx.userId;
      discordType = "user";
      targetDesc = "You (globally)";
    }

    const result = addDiscordEntity(discordId, discordType, entity.id, scopeGuildId, scopeChannelId);

    if (!result) {
      await respond(ctx.bot, ctx.interaction, `"${entity.name}" is already bound to ${targetDesc.toLowerCase()}`, true);
      return;
    }

    await respond(ctx.bot, ctx.interaction, `${targetDesc} bound to "${entity.name}"`, true);
  },
});

// =============================================================================
// /unbind - Remove entity binding
// =============================================================================

registerCommand({
  name: "unbind",
  description: "Remove an entity binding from a channel, server, or user",
  options: [
    {
      name: "target",
      description: "What to unbind from",
      type: ApplicationCommandOptionTypes.String,
      required: true,
      choices: [
        { name: "This channel", value: "channel" },
        { name: "This server", value: "server" },
        { name: "Me (this channel)", value: "me:channel" },
        { name: "Me (this server)", value: "me:server" },
        { name: "Me (global)", value: "me:global" },
      ],
    },
    {
      name: "entity",
      description: "Entity name or ID to unbind",
      type: ApplicationCommandOptionTypes.String,
      required: true,
      autocomplete: true,
    },
  ],
  async handler(ctx, options) {
    const target = options.target as string;
    const entityInput = options.entity as string;

    // Find entity (need facts for permission checks)
    let entity: EntityWithFacts | null = null;
    const id = parseInt(entityInput);
    if (!isNaN(id)) {
      entity = getEntityWithFacts(id);
    }
    if (!entity) {
      entity = getEntityWithFactsByName(entityInput);
    }

    if (!entity) {
      await respond(ctx.bot, ctx.interaction, `Entity not found: ${entityInput}`, true);
      return;
    }

    const isPersonaBind = target.startsWith("me:");

    // Server admins (Manage Channels) can unbind entities from their own channels/server
    // without needing entity-level edit permission.
    const memberPerms = ctx.interaction.member?.permissions;
    const hasManageChannels =
      memberPerms != null &&
      typeof memberPerms === "object" &&
      (memberPerms.has("MANAGE_CHANNELS") || memberPerms.has("ADMINISTRATOR"));

    // Entity-side permission check (skipped for non-persona binds if caller has Manage Channels)
    if (isPersonaBind) {
      if (!canUserUse(entity, ctx.userId, ctx.username, ctx.userRoles)) {
        await respond(ctx.bot, ctx.interaction, "You don't have permission to unbind this persona", true);
        return;
      }
    } else if (!hasManageChannels) {
      if (!canUserEdit(entity, ctx.userId, ctx.username, ctx.userRoles)) {
        await respond(ctx.bot, ctx.interaction, "You don't have permission to unbind this entity", true);
        return;
      }
    }

    // Server-side permission check (skip for global persona)
    if (target !== "me:global") {
      if (isPersonaBind) {
        if (!canUserPersonaInLocation(ctx.userId, ctx.username, ctx.userRoles, ctx.channelId, ctx.guildId)) {
          await respond(ctx.bot, ctx.interaction, "You don't have permission to manage personas here", true);
          return;
        }
      } else {
        if (!canUserBindInLocation(ctx.userId, ctx.username, ctx.userRoles, ctx.channelId, ctx.guildId)) {
          await respond(ctx.bot, ctx.interaction, "You don't have permission to manage bindings here", true);
          return;
        }
      }
    }

    // Parse target into discordType and scope
    let discordId: string;
    let discordType: "user" | "channel" | "guild";
    let scopeGuildId: string | undefined;
    let scopeChannelId: string | undefined;
    let targetDesc: string;

    if (target === "channel") {
      discordId = ctx.channelId;
      discordType = "channel";
      targetDesc = "This channel";
    } else if (target === "server") {
      if (!ctx.guildId) {
        await respond(ctx.bot, ctx.interaction, "Cannot unbind from server in DMs", true);
        return;
      }
      discordId = ctx.guildId;
      discordType = "guild";
      targetDesc = "This server";
    } else if (target === "me:channel") {
      discordId = ctx.userId;
      discordType = "user";
      scopeChannelId = ctx.channelId;
      targetDesc = "You (in this channel)";
    } else if (target === "me:server") {
      if (!ctx.guildId) {
        await respond(ctx.bot, ctx.interaction, "Cannot use server scope in DMs", true);
        return;
      }
      discordId = ctx.userId;
      discordType = "user";
      scopeGuildId = ctx.guildId;
      targetDesc = "You (in this server)";
    } else {
      // me:global
      discordId = ctx.userId;
      discordType = "user";
      targetDesc = "You (globally)";
    }

    const removed = removeDiscordEntityBinding(discordId, discordType, entity.id, scopeGuildId, scopeChannelId);

    if (!removed) {
      await respond(ctx.bot, ctx.interaction, `"${entity.name}" was not bound to ${targetDesc.toLowerCase()}`, true);
      return;
    }

    await respond(ctx.bot, ctx.interaction, `${targetDesc} unbound from "${entity.name}"`, true);
  },
});

// =============================================================================
// /config - Configure channel/server bind permissions
// =============================================================================

const CONFIG_FIELDS = ["bind", "persona", "blacklist"] as const;
type ConfigField = (typeof CONFIG_FIELDS)[number];

const CONFIG_LABELS: Record<ConfigField, string> = {
  bind: "Bind access",
  persona: "Persona access",
  blacklist: "Blacklist",
};

const CONFIG_DESCRIPTIONS: Record<ConfigField, string> = {
  bind: "Who can bind entities here. Blank = everyone.",
  persona: "Who can use personas here. Blank = everyone.",
  blacklist: "Blocked from all binding operations.",
};

function buildConfigLabels(discordId: string, discordType: "channel" | "guild"): unknown[] {
  const config = getDiscordConfig(discordId, discordType);

  return CONFIG_FIELDS.map(field => {
    const rawValue = config?.[`config_${field}`] ?? null;
    const parsed: string[] | null = safeParseFallback<string[] | null>(rawValue, null);
    const defaultValues = buildDefaultValues(parsed);

    const select: Record<string, unknown> = {
      type: MessageComponentTypes.MentionableSelect,
      customId: `config_${field}`,
      required: false,
      minValues: 0,
      maxValues: 25,
    };
    if (defaultValues.length > 0) {
      select.defaultValues = defaultValues;
    }

    return {
      type: MessageComponentTypes.Label,
      label: CONFIG_LABELS[field],
      description: CONFIG_DESCRIPTIONS[field],
      component: select,
    };
  });
}

registerCommand({
  name: "config",
  description: "Configure channel or server bind permissions",
  noDefer: true,
  defaultMemberPermissions: "16", // MANAGE_CHANNELS
  options: [
    {
      name: "scope",
      description: "What to configure",
      type: ApplicationCommandOptionTypes.String,
      required: true,
      choices: [
        { name: "This channel", value: "channel" },
        { name: "This server", value: "server" },
      ],
    },
  ],
  async handler(ctx, options) {
    const scope = options.scope as string;

    if (!ctx.guildId) {
      await respond(ctx.bot, ctx.interaction, "This command is only available in servers", true);
      return;
    }

    const discordId = scope === "server" ? ctx.guildId : ctx.channelId;
    const discordType = scope === "server" ? "guild" as const : "channel" as const;
    const title = scope === "server" ? "Server Bind Settings" : "Channel Bind Settings";

    const labels = buildConfigLabels(discordId, discordType);
    await respondWithV2Modal(ctx.bot, ctx.interaction, `config:${discordType}:${discordId}`, title, labels);
  },
});

registerModalHandler("config", async (bot, interaction, _values) => {
  const customId = interaction.data?.customId ?? "";
  const parts = customId.split(":");
  const discordType = parts[1] as "channel" | "guild";
  const discordId = parts[2];

  // Parse V2 components (same pattern as edit-permissions)
  const resolved = interaction.data?.resolved;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const components: any[] = interaction.data?.components ?? [];

  const selectValues: Record<string, string[]> = {};
  for (const comp of components) {
    const inner = comp.component;
    if (inner?.customId) {
      selectValues[inner.customId] = inner.values ?? [];
    }
    for (const child of comp.components ?? []) {
      if (child.customId && child.values) {
        selectValues[child.customId] = child.values;
      }
    }
  }

  const bindEntries = buildEntries(selectValues.config_bind ?? [], resolved as ResolvedData | undefined);
  const personaEntries = buildEntries(selectValues.config_persona ?? [], resolved as ResolvedData | undefined);
  const blacklistEntries = buildEntries(selectValues.config_blacklist ?? [], resolved as ResolvedData | undefined);

  // If all fields are empty, delete the row entirely
  if (bindEntries.length === 0 && personaEntries.length === 0 && blacklistEntries.length === 0) {
    deleteDiscordConfig(discordId, discordType);
    const scopeLabel = discordType === "guild" ? "server" : "channel";
    await respond(bot, interaction, `Cleared all bind settings for this ${scopeLabel} (everyone can bind)`, true);
    return;
  }

  setDiscordConfig(discordId, discordType, {
    config_bind: bindEntries.length > 0 ? JSON.stringify(bindEntries) : null,
    config_persona: personaEntries.length > 0 ? JSON.stringify(personaEntries) : null,
    config_blacklist: blacklistEntries.length > 0 ? JSON.stringify(blacklistEntries) : null,
  });

  const scopeLabel = discordType === "guild" ? "server" : "channel";
  await respond(bot, interaction, `Updated bind settings for this ${scopeLabel}`, true);
});

// =============================================================================
// /config-chain - Set per-channel/guild MAX_RESPONSE_CHAIN override
// =============================================================================

registerCommand({
  name: "config-chain",
  description: "Set or clear the response chain limit for this channel or server",
  noDefer: true,
  defaultMemberPermissions: "536870912", // MANAGE_WEBHOOKS
  options: [
    {
      name: "scope",
      description: "What to configure",
      type: ApplicationCommandOptionTypes.String,
      required: true,
      choices: [
        { name: "This channel", value: "channel" },
        { name: "This server", value: "server" },
      ],
    },
  ],
  async handler(ctx, options) {
    const scope = options.scope as string;

    if (!ctx.guildId) {
      await respond(ctx.bot, ctx.interaction, "This command is only available in servers", true);
      return;
    }

    const discordId = scope === "server" ? ctx.guildId : ctx.channelId;
    const discordType = scope === "server" ? "guild" as const : "channel" as const;
    const scopeLabel = scope === "server" ? "server" : "channel";

    const currentConfig = getDiscordConfig(discordId, discordType);
    const currentLimit = currentConfig?.config_chain_limit ?? null;

    const fields = [
      {
        customId: "chain_limit",
        label: "Response Chain Limit",
        style: TextStyles.Short,
        value: currentLimit !== null ? String(currentLimit) : "",
        required: false,
        placeholder: "0–20, or empty to inherit from server/env default",
      },
    ];

    await respondWithModal(
      ctx.bot,
      ctx.interaction,
      `config-chain:${discordType}:${discordId}:${scopeLabel}`,
      `Chain Limit: ${scopeLabel}`,
      fields,
    );
  },
});

registerModalHandler("config-chain", async (bot, interaction, values) => {
  const customId = interaction.data?.customId ?? "";
  const parts = customId.split(":");
  const discordType = parts[1] as "channel" | "guild";
  const discordId = parts[2];
  const scopeLabel = parts[3] ?? discordType;

  const raw = values.chain_limit?.trim() ?? "";

  if (raw === "") {
    // Clear the override — preserve other fields on the row
    const existing = resolveDiscordConfig(
      discordType === "channel" ? discordId : undefined,
      discordType === "guild" ? discordId : undefined,
    );
    setDiscordConfig(discordId, discordType, {
      config_bind: existing.bind !== null ? JSON.stringify(existing.bind) : null,
      config_persona: existing.persona !== null ? JSON.stringify(existing.persona) : null,
      config_blacklist: existing.blacklist !== null ? JSON.stringify(existing.blacklist) : null,
      config_chain_limit: null,
    });
    await respond(bot, interaction, `Cleared chain limit override for this ${scopeLabel} (inheriting default)`, true);
    return;
  }

  const value = parseInt(raw, 10);
  if (isNaN(value) || value < 0 || value > 20) {
    await respond(bot, interaction, "Chain limit must be a number between 0 and 20, or empty to clear the override. Use 0 to prevent entities from responding to each other entirely.", true);
    return;
  }

  const existing = resolveDiscordConfig(
    discordType === "channel" ? discordId : undefined,
    discordType === "guild" ? discordId : undefined,
  );
  setDiscordConfig(discordId, discordType, {
    config_bind: existing.bind !== null ? JSON.stringify(existing.bind) : null,
    config_persona: existing.persona !== null ? JSON.stringify(existing.persona) : null,
    config_blacklist: existing.blacklist !== null ? JSON.stringify(existing.blacklist) : null,
    config_chain_limit: value,
  });

  const msg = value === 0
    ? `Set response chain limit to **0** for this ${scopeLabel} — entities will not respond to each other's messages`
    : `Set response chain limit to **${value}** for this ${scopeLabel}`;
  await respond(bot, interaction, msg, true);
});

// =============================================================================
// /trigger - Manually trigger an entity response
// =============================================================================

registerCommand({
  name: "trigger",
  description: "Manually trigger an entity to respond in this channel",
  options: [
    {
      name: "entity",
      description: "Entity name",
      type: ApplicationCommandOptionTypes.String,
      required: true,
      autocomplete: true,
    },
    {
      name: "verb",
      description: "Interaction verb requiring a persona (e.g. drink, eat, open, use)",
      type: ApplicationCommandOptionTypes.String,
      required: false,
    },
  ],
  async handler(ctx, options) {
    const input = options.entity as string;

    // Resolve entity
    let entity: EntityWithFacts | null = null;
    const id = parseInt(input);
    if (!isNaN(id)) {
      entity = getEntityWithFacts(id);
    }
    if (!entity) {
      entity = getEntityWithFactsByName(input);
    }

    if (!entity) {
      await respond(ctx.bot, ctx.interaction, `Entity not found: ${input}`, true);
      return;
    }

    // Check permissions
    const facts = entity.facts.map(f => f.content);
    const permissions = parsePermissionDirectives(facts, getPermissionDefaults(entity.id));

    if (isUserBlacklisted(permissions, ctx.userId, ctx.username, entity.owned_by, ctx.userRoles)) {
      await respond(ctx.bot, ctx.interaction, "You don't have permission to trigger this entity", true);
      return;
    }

    if (!isUserAllowed(permissions, ctx.userId, ctx.username, entity.owned_by, ctx.userRoles)) {
      await respond(ctx.bot, ctx.interaction, "You don't have permission to trigger this entity", true);
      return;
    }

    // Resolve interaction verb + persona (verb requires persona)
    const verb = options.verb as string | undefined;
    let interactionType = "";
    let interactionAuthor: string | null = null;

    if (verb) {
      const personaEntityId = resolvePersona(ctx.userId, ctx.guildId, ctx.channelId);
      if (personaEntityId === null) {
        await respond(ctx.bot, ctx.interaction, "You need a persona bound to use verb interactions. Use `/bind` to bind an entity to your account.", true);
        return;
      }
      const personaEntity = getEntity(personaEntityId);
      if (!personaEntity) {
        await respond(ctx.bot, ctx.interaction, "Could not resolve your persona entity.", true);
        return;
      }
      interactionType = verb;
      interactionAuthor = personaEntity.name;
    }

    // Get last message from channel for context
    const lastMessages = getMessages(ctx.channelId, 1);
    const lastAuthor = interactionAuthor ?? (lastMessages.length > 0 ? lastMessages[0].author_name : ctx.username);
    const lastContent = lastMessages.length > 0 ? lastMessages[0].content : "";

    // Evaluate facts (ignore shouldRespond - we always trigger)
    const ctx2 = createBaseContext({
      facts,
      has_fact: (pattern: string) => {
        const regex = new RegExp(pattern, "i");
        return facts.some(f => regex.test(f));
      },
      messages: (n = 1, format?: string, filter?: string) =>
        filter
          ? formatMessagesForContext(getFilteredMessages(ctx.channelId, n, filter), format)
          : formatMessagesForContext(getMessages(ctx.channelId, n), format),
      response_ms: 0,
      retry_ms: 0,
      idle_ms: 0,
      unread_count: 0,
      mentioned: true, // Treat as mentioned for fact evaluation
      replied: false,
      replied_to: "",
      is_forward: false,
      is_self: false,
      is_hologram: interactionAuthor !== null,
      silent: false,
      interaction_type: interactionType,
      name: entity.name,
      chars: [entity.name],
      channel: { id: ctx.channelId, name: "", description: "", is_nsfw: false, type: "text", mention: "" },
      server: { id: ctx.guildId ?? "", name: "", description: "", nsfw_level: "default" },
    });

    let result;
    try {
      result = evaluateFacts(facts, ctx2, getEntityEvalDefaults(entity.id));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await respond(ctx.bot, ctx.interaction, `Fact evaluation error: ${errorMsg}`, true);
      return;
    }

    // Respond ephemeral then trigger
    await respond(ctx.bot, ctx.interaction, `Triggering **${entity.name}**...`, true);

    debug("Manual trigger", { entity: entity.name, user: ctx.username });

    await sendResponse(ctx.channelId, ctx.guildId, lastAuthor, lastContent, true, [{
      id: entity.id,
      name: entity.name,
      ownedBy: entity.owned_by ?? null,
      facts: result.facts,
      avatarUrl: result.avatarUrl,
      streamMode: result.streamMode,
      streamDelimiter: result.streamDelimiter,
      memoryScope: result.memoryScope,
      contextExpr: result.contextExpr,
      isFreeform: result.isFreeform,
      modelSpec: result.modelSpec,
      stripPatterns: result.stripPatterns,
      thinkingLevel: result.thinkingLevel,
      collapseMessages: result.collapseMessages,
      contentFilters: result.contentFilters,
      template: entity.template,
      systemTemplate: entity.system_template,
      exprContext: ctx2,
    }]);
  },
});

// =============================================================================
// /forget - Clear message history from context
// =============================================================================

registerCommand({
  name: "forget",
  description: "Forget message history before now (excludes from LLM context)",
  options: [],
  async handler(ctx, _options) {
    setChannelForgetTime(ctx.channelId);
    await respond(ctx.bot, ctx.interaction, "Done. Messages before now will be excluded from context.", true);
  },
});
