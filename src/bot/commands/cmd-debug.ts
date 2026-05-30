import { ApplicationCommandOptionTypes } from "@discordeno/bot";
import {
  registerCommand,
  respond,
  respondWithContext,
  type CommandContext,
} from "./index";
import {
  getEntity,
  getEntityWithFacts,
  getEntityWithFactsByName,
  getEntityConfig,
  formatEntityName,
} from "../../db/entities";
import {
  getChannelScopedEntities,
  getGuildScopedEntities,
  resolveDiscordEntity,
  resolveDiscordEntities,
  countUnreadMessages,
  getSystemNoteCount,
  getRecentSystemNotes,
  getMessages,
} from "../../db/discord";
import { listActiveMutes } from "../../db/moderation";
import { discordRelative } from "../duration";
import { createBaseContext, compileContextExpr } from "../../logic/expr";
import { DEFAULT_RAG_CONTEXT_EXPR } from "../../ai/context";
import { buildEvaluatedEntity } from "../../debug/evaluation";
import { preparePromptContext } from "../../ai/prompt";
import { getEmbeddingCoverage, testRagRetrieval } from "../../debug/embeddings";
import { MIN_SIMILARITY_THRESHOLD, retrieveRelevantMemories, type MemoryScope } from "../../db/memories";
import { getChannelMetadata, getGuildMetadata } from "../client";
import { elideText } from "./helpers";
import { canUserView, canOwnerReadChannel, type ChannelCheckBot } from "./cmd-permissions";

// =============================================================================
// /debug - View channel state and debug info
// =============================================================================

registerCommand({
  name: "debug",
  description: "View channel state and debug info",
  options: [
    {
      name: "status",
      description: "View current channel state (default)",
      type: ApplicationCommandOptionTypes.SubCommand,
    },
    {
      name: "prompt",
      description: "Show system prompt that would be sent to the LLM",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "entity",
          description: "Entity to simulate (defaults to channel-bound entity)",
          type: ApplicationCommandOptionTypes.String,
          required: false,
          autocomplete: true,
        },
      ],
    },
    {
      name: "context",
      description: "Show message context that would be sent to the LLM",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "entity",
          description: "Entity to simulate (defaults to channel-bound entity)",
          type: ApplicationCommandOptionTypes.String,
          required: false,
          autocomplete: true,
        },
        {
          name: "query",
          description: "Override RAG query (defaults to recent channel messages)",
          type: ApplicationCommandOptionTypes.String,
          required: false,
        },
      ],
    },
    {
      name: "rag",
      description: "Show embedding status and test RAG retrieval",
      type: ApplicationCommandOptionTypes.SubCommand,
      options: [
        {
          name: "entity",
          description: "Entity to query (defaults to channel-bound entity)",
          type: ApplicationCommandOptionTypes.String,
          required: false,
          autocomplete: true,
        },
        {
          name: "query",
          description: "Search query for RAG retrieval",
          type: ApplicationCommandOptionTypes.String,
          required: false,
        },
      ],
    },
  ],
  async handler(ctx: CommandContext, options) {
    // Get subcommand from nested options
    const subcommand = (options._subcommand as string) ?? "status";

    if (subcommand === "prompt") {
      await handleInfoPrompt(ctx, options);
    } else if (subcommand === "context") {
      await handleInfoContext(ctx, options);
    } else if (subcommand === "rag") {
      await handleInfoRag(ctx, options);
    } else {
      await handleInfoStatus(ctx);
    }
  },
});

async function handleInfoStatus(ctx: CommandContext) {
  const lines: string[] = [];

  // Check channel bindings (direct query, not precedence-based)
  const channelEntityIds = getChannelScopedEntities(ctx.channelId);
  if (channelEntityIds.length > 0) {
    const entityNames: string[] = [];
    for (const entityId of channelEntityIds) {
      const entity = getEntity(entityId);
      if (entity) entityNames.push(formatEntityName(entity));
    }
    lines.push(`**Channel:** ${entityNames.join(", ")}`);

    // Show location for first entity that has one
    for (const entityId of channelEntityIds) {
      const entity = getEntityWithFacts(entityId);
      if (entity) {
        const locationFact = entity.facts.find(f => f.content.startsWith("is in "));
        if (locationFact) {
          lines.push(`**Location:** ${locationFact.content.replace("is in ", "")}`);
          break;
        }
      }
    }
  } else {
    lines.push("**Channel:** No bindings");
  }

  // Check server bindings (direct query), annotate any skipped by confused-deputy filter
  if (ctx.guildId) {
    const serverEntityIds = getGuildScopedEntities(ctx.guildId);
    if (serverEntityIds.length > 0) {
      const entityNames: string[] = [];
      const skippedNames: string[] = [];
      const guildIdBig = BigInt(ctx.guildId);
      const channelIdBig = BigInt(ctx.channelId);
      await Promise.all(serverEntityIds.map(async (entityId) => {
        const entity = getEntity(entityId);
        if (!entity) return;
        const canRead = !entity.owned_by ||
          await canOwnerReadChannel(ctx.bot as unknown as ChannelCheckBot, entity.owned_by, guildIdBig, channelIdBig);
        if (canRead) {
          entityNames.push(formatEntityName(entity));
        } else {
          skippedNames.push(formatEntityName(entity));
        }
      }));
      const parts: string[] = [];
      if (entityNames.length > 0) parts.push(entityNames.join(", "));
      if (skippedNames.length > 0) parts.push(`~~${skippedNames.join(", ")}~~ *(skipped: owner lacks channel access)*`);
      lines.push(`**Server:** ${parts.join(", ")}`);
    } else {
      lines.push("**Server:** No bindings");
    }
  }

  // Check user binding
  const userEntityId = resolveDiscordEntity(ctx.userId, "user", ctx.guildId, ctx.channelId);
  if (userEntityId) {
    const userEntity = getEntityWithFacts(userEntityId);
    if (userEntity) {
      lines.push(`**Your persona:** ${formatEntityName(userEntity)}`);
    }
  } else {
    lines.push(`**Your persona:** ${ctx.username} (default)`);
  }

  // Show system note count
  const noteCount = getSystemNoteCount(ctx.channelId);
  if (noteCount > 0) {
    const recentNotes = getRecentSystemNotes(ctx.channelId, 3);
    const noteLine = `**System notes:** ${noteCount} in context`;
    lines.push(noteLine);
    for (const note of recentNotes) {
      const preview = note.content.length > 60 ? note.content.slice(0, 60) + "…" : note.content;
      lines.push(`  • ${preview}`);
    }
    if (noteCount > 3) {
      lines.push(`  _(${noteCount - 3} more)_`);
    }
  }

  // Show active mutes applying to this channel/guild
  {
    const allMutes = listActiveMutes({});
    const guildId = ctx.guildId;
    const channelId = ctx.channelId;

    // Filter to mutes that cover this channel:
    // - channel kill-switch: scope_type=channel, scope_id=channelId
    // - guild kill-switch: scope_type=guild, scope_id=guildId, channel_id IS NULL, guild_id IS NULL
    // - global entity mutes: channel_id IS NULL AND guild_id IS NULL
    // - guild-wide entity mutes: guild_id=guildId AND channel_id IS NULL
    // - channel-specific entity mutes: channel_id=channelId AND guild_id=guildId
    const relevantMutes = allMutes.filter(m => {
      // Channel kill-switch
      if (m.scope_type === "channel" && m.scope_id === channelId) return true;
      // Guild kill-switch (stored with both null)
      if (m.scope_type === "guild" && m.scope_id === guildId &&
          m.channel_id === null && m.guild_id === null) return true;
      // Entity/owner mutes: apply if location matches
      if (m.scope_type === "entity" || m.scope_type === "owner") {
        // Global mute
        if (m.channel_id === null && m.guild_id === null) return true;
        // Guild-wide mute
        if (m.channel_id === null && guildId && m.guild_id === guildId) return true;
        // Channel-specific mute
        if (m.channel_id === channelId && guildId && m.guild_id === guildId) return true;
      }
      return false;
    });

    if (relevantMutes.length > 0) {
      lines.push(`**Mutes** (${relevantMutes.length} active):`);
      for (const m of relevantMutes) {
        let targetLabel: string;
        if (m.scope_type === "channel") {
          targetLabel = `kill-switch on <#${m.scope_id}>`;
        } else if (m.scope_type === "guild") {
          targetLabel = `server kill-switch`;
        } else {
          targetLabel = `${m.scope_type} \`${m.scope_id}\``;
        }
        const expiry = m.expires_at ? discordRelative(m.expires_at) : "permanent";
        lines.push(`  • ${targetLabel} — ${expiry}`);
      }
    }
  }

  // Show hints
  const hints: string[] = [];
  const hasChannelBindings = channelEntityIds.length > 0;
  const hasServerBindings = ctx.guildId ? getGuildScopedEntities(ctx.guildId).length > 0 : false;
  const hasPersona = userEntityId !== null;

  if (!hasChannelBindings && !hasServerBindings) {
    hints.push("`/bind This channel <entity>` or `/bind This server <entity>` to add bindings");
  } else {
    hints.push("`/unbind` to remove bindings");
  }
  if (!hasPersona) {
    hints.push("`/bind Me (user) <entity>` to set a persona");
  }

  if (hints.length > 0) {
    lines.push("");
    lines.push(hints.join(", ") + ".");
  }

  await respond(ctx.bot, ctx.interaction, lines.join("\n"), true);
}

async function resolveTargetEntity(
  ctx: CommandContext,
  entityInput: string | undefined,
  commandHint: string
) {
  if (entityInput) {
    // User specified an entity
    const id = parseInt(entityInput);
    let entity = null;
    if (!isNaN(id)) {
      entity = getEntityWithFacts(id);
    }
    if (!entity) {
      entity = getEntityWithFactsByName(entityInput);
    }
    if (!entity) {
      await respond(ctx.bot, ctx.interaction, `Entity not found: ${entityInput}`, true);
      return null;
    }
    return entity;
  }

  // Use first channel-bound entity
  const channelEntityIds = resolveDiscordEntities(ctx.channelId, "channel", ctx.guildId, ctx.channelId);
  if (channelEntityIds.length > 0) {
    const entity = getEntityWithFacts(channelEntityIds[0]);
    if (entity) return entity;
  }

  await respond(ctx.bot, ctx.interaction, `No entity bound to this channel. Specify an entity with \`/debug ${commandHint} entity:<name>\``, true);
  return null;
}

async function handleInfoPrompt(ctx: CommandContext, options: Record<string, unknown>) {
  const entityInput = options.entity as string | undefined;
  const targetEntity = await resolveTargetEntity(ctx, entityInput, "prompt");
  if (!targetEntity) return;
  if (!canUserView(targetEntity, ctx.userId, ctx.username, ctx.userRoles)) {
    await respond(ctx.bot, ctx.interaction, "You don't have permission to view this entity", true);
    return;
  }

  // Fetch channel/server metadata for template context
  const channelMeta = await getChannelMetadata(ctx.channelId);
  const guildMeta = ctx.guildId ? await getGuildMetadata(ctx.guildId) : undefined;

  // Build expression context with real metadata (no triggers active)
  const rawFacts = targetEntity.facts.map(f => f.content);
  const exprCtx = createBaseContext({
    facts: rawFacts,
    has_fact: (pattern: string) => rawFacts.some(f => new RegExp(pattern, "i").test(f)),
    messages: () => "",
    response_ms: 0,
    retry_ms: 0,
    idle_ms: 0,
    unread_count: countUnreadMessages(ctx.channelId, targetEntity.id),
    mentioned: false,
    replied: false,
    replied_to: "",
    is_forward: false,
    is_self: false,
    is_hologram: false,
      silent: false,
    interaction_type: "",
    name: targetEntity.name,
    chars: getChannelScopedEntities(ctx.channelId).map(id => { const e = getEntity(id); return e ? e.name : ""; }).filter(Boolean),
    channel: channelMeta,
    server: guildMeta ?? { id: "", name: "", description: "", nsfw_level: "default" },
  });
  const evaluated = buildEvaluatedEntity(targetEntity, exprCtx);

  // Use the actual template pipeline to build messages
  const { systemPrompt } = preparePromptContext(
    [evaluated], ctx.channelId, ctx.guildId, ctx.userId,
  );

  await respond(ctx.bot, ctx.interaction, elideText(systemPrompt || "(no system prompt)"), true);
}

// Resolve RAG query texts the same way the real pipeline does: use the
// explicit query if provided, otherwise replicate the channel's RAG context
// window via config_rag_context (or DEFAULT_RAG_CONTEXT_EXPR).
function resolveRagQueryTexts(
  ctx: CommandContext,
  ragContextExpr: string | null | undefined,
  query: string | undefined,
): { queryTextsWithName: string[]; queryTextsWithoutName: string[]; queryLabel: string } {
  if (query) {
    // Explicit query: both variants are identical (no author name distinction)
    return { queryTextsWithName: [query], queryTextsWithoutName: [query], queryLabel: `"${query}"` };
  }
  const expr = ragContextExpr ?? DEFAULT_RAG_CONTEXT_EXPR;
  const contextFilter = compileContextExpr(expr);
  const rawMessages = getMessages(ctx.channelId, 100);
  const now = Date.now();
  const queryTextsWithName: string[] = [];
  const queryTextsWithoutName: string[] = [];
  let totalChars = 0;
  for (const m of rawMessages) {
    const formatted = `${m.author_name}: ${m.content}`;
    const len = formatted.length + 1;
    const msgAge = now - new Date(m.created_at).getTime();
    const shouldInclude = contextFilter({
      chars: totalChars + len, count: queryTextsWithName.length,
      age: msgAge, age_h: msgAge / 3_600_000,
      age_m: msgAge / 60_000, age_s: msgAge / 1000,
    });
    if (!shouldInclude && queryTextsWithName.length > 0) break;
    queryTextsWithName.push(formatted);
    if (m.content) queryTextsWithoutName.push(m.content);
    totalChars += len;
  }
  return { queryTextsWithName, queryTextsWithoutName, queryLabel: `context window (${queryTextsWithName.length} messages)` };
}

async function handleInfoContext(ctx: CommandContext, options: Record<string, unknown>) {
  const entityInput = options.entity as string | undefined;
  const query = options.query as string | undefined;
  const targetEntity = await resolveTargetEntity(ctx, entityInput, "context");
  if (!targetEntity) return;
  if (!canUserView(targetEntity, ctx.userId, ctx.username, ctx.userRoles)) {
    await respond(ctx.bot, ctx.interaction, "You don't have permission to view this entity", true);
    return;
  }

  // Fetch channel/server metadata for template context
  const channelMeta = await getChannelMetadata(ctx.channelId);
  const guildMeta = ctx.guildId ? await getGuildMetadata(ctx.guildId) : undefined;

  // Build expression context with real metadata (no triggers active)
  const rawFacts = targetEntity.facts.map(f => f.content);
  const exprCtx = createBaseContext({
    facts: rawFacts,
    has_fact: (pattern: string) => rawFacts.some(f => new RegExp(pattern, "i").test(f)),
    messages: () => "",
    response_ms: 0,
    retry_ms: 0,
    idle_ms: 0,
    unread_count: countUnreadMessages(ctx.channelId, targetEntity.id),
    mentioned: false,
    replied: false,
    replied_to: "",
    is_forward: false,
    is_self: false,
    is_hologram: false,
      silent: false,
    interaction_type: "",
    name: targetEntity.name,
    chars: getChannelScopedEntities(ctx.channelId).map(id => { const e = getEntity(id); return e ? e.name : ""; }).filter(Boolean),
    channel: channelMeta,
    server: guildMeta ?? { id: "", name: "", description: "", nsfw_level: "default" },
  });
  const evaluated = buildEvaluatedEntity(targetEntity, exprCtx);

  // Retrieve memories via RAG so they show up in the rendered context
  // (matches the real pipeline in src/bot/client.ts).
  const config = getEntityConfig(targetEntity.id);
  const memoryScope = (config?.config_memory ?? "none") as MemoryScope;
  let entityMemories: Map<number, Array<{ content: string }>> | undefined;
  if (memoryScope !== "none") {
    const { queryTextsWithName, queryTextsWithoutName } = resolveRagQueryTexts(ctx, config?.config_rag_context, query);
    const memories = await retrieveRelevantMemories(
      targetEntity.id, queryTextsWithName, queryTextsWithoutName, memoryScope, ctx.channelId, ctx.guildId,
    );
    if (memories.length > 0) {
      entityMemories = new Map([[targetEntity.id, memories.map(m => ({ content: m.content }))]]);
    }
  }

  // Use the actual template pipeline to build structured messages
  const { messages } = preparePromptContext(
    [evaluated], ctx.channelId, ctx.guildId, ctx.userId, entityMemories,
  );

  // Show all messages (system, user, assistant) — each as a separate embed
  // with the role as title and content verbatim in a code block.
  await respondWithContext(ctx.bot, ctx.interaction, messages);
}

async function handleInfoRag(ctx: CommandContext, options: Record<string, unknown>) {
  const entityInput = options.entity as string | undefined;
  const query = options.query as string | undefined;
  const targetEntity = await resolveTargetEntity(ctx, entityInput, "rag");
  if (!targetEntity) return;
  if (!canUserView(targetEntity, ctx.userId, ctx.username, ctx.userRoles)) {
    await respond(ctx.bot, ctx.interaction, "You don't have permission to view this entity", true);
    return;
  }

  const lines: string[] = [];

  const config = getEntityConfig(targetEntity.id);
  const memoryScope = (config?.config_memory ?? "none") as string;
  lines.push(`**${targetEntity.name}** — memory scope: \`${memoryScope}\``);

  // Only show coverage when something is actually missing
  const coverage = getEmbeddingCoverage(targetEntity.id);
  if (coverage.memories.withEmbedding < coverage.memories.total) {
    lines.push(`⚠ Memories: ${coverage.memories.withEmbedding}/${coverage.memories.total} embedded`);
  }

  if (memoryScope === "none") {
    lines.push(`*Memory is disabled — no retrieval occurs.*`);
  } else {
    const { queryTextsWithName, queryLabel } = resolveRagQueryTexts(ctx, config?.config_rag_context, query);

    lines.push(`\n**RAG** (scope: ${memoryScope}, threshold: ${MIN_SIMILARITY_THRESHOLD}) — ${queryLabel}`);
    const results = await testRagRetrieval(
      targetEntity.id, queryTextsWithName,
      memoryScope as "channel" | "guild" | "global",
      ctx.channelId, ctx.guildId,
    );
    if (results.length === 0) {
      lines.push("No memories retrieved.");
    } else {
      for (const r of results.slice(0, 15)) {
        const sim = (r.similarity * 100).toFixed(1);
        const passes = r.similarity >= MIN_SIMILARITY_THRESHOLD;
        const preview = r.content.length > 100 ? r.content.slice(0, 100) + "…" : r.content;
        lines.push(`${passes ? "✓" : "✗"} \`${sim}%\` ${preview}`);
      }
    }
  }

  await respond(ctx.bot, ctx.interaction, elideText(lines.join("\n")), true);
}
