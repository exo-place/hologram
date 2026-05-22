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
import { createBaseContext, compileContextExpr } from "../../logic/expr";
import { DEFAULT_RAG_CONTEXT_EXPR } from "../../ai/context";
import { buildEvaluatedEntity } from "../../debug/evaluation";
import { preparePromptContext } from "../../ai/prompt";
import { getEmbeddingCoverage, testRagRetrieval } from "../../debug/embeddings";
import { MIN_SIMILARITY_THRESHOLD } from "../../db/memories";
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

async function handleInfoContext(ctx: CommandContext, options: Record<string, unknown>) {
  const entityInput = options.entity as string | undefined;
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

  // Use the actual template pipeline to build structured messages
  const { messages } = preparePromptContext(
    [evaluated], ctx.channelId, ctx.guildId, ctx.userId,
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
    // Use provided query, or fall back to recent channel messages (mirrors real pipeline)
    let queryTexts: string[];
    let queryLabel: string;
    if (query) {
      queryTexts = [query];
      queryLabel = `"${query}"`;
    } else {
      // Replicate the exact RAG context window (same logic as the pipeline)
      const ragContextExpr = config?.config_rag_context ?? DEFAULT_RAG_CONTEXT_EXPR;
      const contextFilter = compileContextExpr(ragContextExpr);
      const rawMessages = getMessages(ctx.channelId, 100);
      const now = Date.now();
      queryTexts = [];
      let totalChars = 0;
      for (const m of rawMessages) {
        const len = `${m.author_name}: ${m.content}`.length + 1;
        const msgAge = now - new Date(m.created_at).getTime();
        const shouldInclude = contextFilter({
          chars: totalChars + len, count: queryTexts.length,
          age: msgAge, age_h: msgAge / 3_600_000,
          age_m: msgAge / 60_000, age_s: msgAge / 1000,
        });
        if (!shouldInclude && queryTexts.length > 0) break;
        if (m.content) queryTexts.push(m.content);
        totalChars += len;
      }
      queryLabel = `context window (${queryTexts.length} messages)`;
    }

    lines.push(`\n**RAG** (scope: ${memoryScope}, threshold: ${MIN_SIMILARITY_THRESHOLD}) — ${queryLabel}`);
    const results = await testRagRetrieval(
      targetEntity.id, queryTexts,
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
