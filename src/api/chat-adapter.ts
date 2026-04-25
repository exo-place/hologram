/**
 * Web chat adapter — bridges web channel messages to the AI pipeline.
 *
 * Replicates the core of the Discord MESSAGE_CREATE handler but stripped of
 * Discord-specific concerns (webhooks, typing indicators, guild metadata).
 *
 * Called fire-and-forget from POST /api/channels/:id/messages.
 * AI responses are delivered to connected SSE clients via broadcastSSE().
 */

import { getEntitiesWithFacts, getEntityEvalDefaults, getEntityKeywords } from "../db/entities";
import { isDedicatedImageModel, parseModelSpec } from "../ai/models";
import { getMessages, addMessage, countUnreadMessages, formatMessagesForContext } from "../db/discord";
import { retrieveRelevantMemories } from "../db/memories";
import { createBaseContext, evaluateFacts, compileContextExpr, type MemoryScope } from "../logic/expr";
import { handleMessageStreaming } from "../ai/streaming";
import { handleMessage } from "../ai/handler";
import { DEFAULT_CONTEXT_EXPR } from "../ai/context";
import type { EvaluatedEntity } from "../ai/context";
import { broadcastSSE } from "./routes/chat";
import { warn, debug } from "../logger";
import { runOnChannel } from "../bot/channel-queue";

// ── Per-channel timing ─────────────────────────────────────────────────────
// Simple in-memory maps tracking last response and last message times per channel.
// These reset on server restart (acceptable for web chat — not persisted).
const lastResponseTime = new Map<string, number>();
const lastMessageTime = new Map<string, number>();

/**
 * Evaluate which entities should respond and fire their responses.
 *
 * @param channelId   Web channel ID (e.g. "web:<uuid>")
 * @param entityIds   Entity IDs bound to this web channel
 * @param authorId    Sender user ID (e.g. "web-user")
 * @param authorName  Sender display name
 * @param content     Message text
 */
export function handleWebMessage(
  channelId: string,
  entityIds: number[],
  authorId: string,
  authorName: string,
  content: string,
): Promise<void> {
  return runOnChannel(channelId, () => _handleWebMessageInner(channelId, entityIds, authorId, authorName, content), { label: "handleWebMessage" });
}

async function _handleWebMessageInner(
  channelId: string,
  entityIds: number[],
  authorId: string,
  authorName: string,
  content: string,
): Promise<void> {
  const messageTime = Date.now();

  // Load entity facts
  const entityMap = getEntitiesWithFacts(entityIds);
  const channelEntities = entityIds.flatMap(id => {
    const e = entityMap.get(id);
    return e ? [e] : [];
  });

  if (channelEntities.length === 0) return;

  // Timing
  const lastResponse = lastResponseTime.get(channelId) ?? 0;
  const lastMsg = lastMessageTime.get(channelId) ?? 0;
  const idleMs = lastMsg > 0 ? messageTime - lastMsg : Infinity;
  lastMessageTime.set(channelId, messageTime);

  // Pre-compute unread counts before any async calls
  const unreadCounts = new Map<number, number>();
  for (const entity of channelEntities) {
    unreadCounts.set(entity.id, countUnreadMessages(channelId, entity.id));
  }

  // Web channels have no Discord guild/server context
  const channelMeta = {
    id: channelId,
    name: channelId,
    description: "",
    is_nsfw: false,
    type: "web",
    mention: channelId,
  };
  const serverMeta = { id: "", name: "", description: "", nsfw_level: "default" };

  // Evaluate each entity
  const respondingEntities: EvaluatedEntity[] = [];
  const facts_cache = new Map<number, string[]>();

  for (const entity of channelEntities) {
    const facts = entity.facts.map(f => f.content);
    facts_cache.set(entity.id, facts);

    const ctx = createBaseContext({
      facts,
      has_fact: (pattern: string) => {
        const regex = new RegExp(pattern, "i");
        return facts.some(f => regex.test(f));
      },
      messages: (n = 1, format?: string) =>
        formatMessagesForContext(getMessages(channelId, n), format),
      response_ms: lastResponse > 0 ? messageTime - lastResponse : Infinity,
      retry_ms: 0,
      idle_ms: idleMs,
      unread_count: unreadCounts.get(entity.id) ?? 0,
      // Web: all messages are "mentioned" (direct chat), no reply threading
      mentioned: true,
      replied: false,
      replied_to: "",
      is_forward: false,
      is_self: false,
      is_hologram: false,
      silent: false,
      interaction_type: "",
      name: entity.name,
      chars: channelEntities.map(e => e.name),
      channel: channelMeta,
      server: serverMeta,
      keywords: getEntityKeywords(entity.id),
    });

    const evalDefaults = getEntityEvalDefaults(entity.id);
    let result;
    try {
      result = evaluateFacts(facts, ctx, evalDefaults);
    } catch (err) {
      warn("Fact evaluation failed (web)", {
        entity: entity.name,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    // Default: respond to all entities in web channel (user is always "mentioning" them)
    const shouldRespond = result.shouldRespond ?? true;

    if (shouldRespond && result.retryMs === null) {
      const imageModelSpec = result.modelSpec && isDedicatedImageModel(parseModelSpec(result.modelSpec).modelName)
        ? result.modelSpec : null;
      const resolvedModelSpec = imageModelSpec ? (evalDefaults.modelSpec ?? null) : result.modelSpec;
      respondingEntities.push({
        id: entity.id,
        name: entity.name,
        facts: result.facts,
        avatarUrl: result.avatarUrl,
        streamMode: result.streamMode,
        streamDelimiter: result.streamDelimiter,
        memoryScope: result.memoryScope,
        contextExpr: result.contextExpr,
        isFreeform: result.isFreeform,
        modelSpec: resolvedModelSpec,
        imageModelSpec,
        stripPatterns: result.stripPatterns,
        thinkingLevel: result.thinkingLevel,
        collapseMessages: result.collapseMessages,
        contentFilters: result.contentFilters,
        template: entity.template,
        systemTemplate: entity.system_template,
        exprContext: ctx,
      });
    }
  }

  if (respondingEntities.length === 0) return;

  // Group by template — entities with different templates get separate LLM calls
  const templateGroups = new Map<string | null, EvaluatedEntity[]>();
  for (const entity of respondingEntities) {
    const key = entity.template ?? null;
    const group = templateGroups.get(key) ?? [];
    group.push(entity);
    templateGroups.set(key, group);
  }

  for (const [, entities] of templateGroups) {
    await fireResponse(channelId, undefined, authorName, content, entities);
  }

  lastResponseTime.set(channelId, Date.now());
}

async function fireResponse(
  channelId: string,
  guildId: string | undefined,
  username: string,
  content: string,
  respondingEntities: EvaluatedEntity[],
): Promise<void> {
  // Retrieve memories for entities with memory enabled
  const entityMemories = new Map<number, Array<{ content: string }>>();
  const contextExpr = respondingEntities.find(e => e.contextExpr !== null)?.contextExpr ?? DEFAULT_CONTEXT_EXPR;
  const contextFilter = compileContextExpr(contextExpr);
  const rawMessages = getMessages(channelId, 100);
  const now = Date.now();
  const contextMessages: string[] = [];
  let totalChars = 0;

  for (const m of rawMessages) {
    const formatted = `${m.author_name}: ${m.content}`;
    const len = formatted.length + 1;
    const msgAge = now - new Date(m.created_at).getTime();
    const shouldInclude = contextFilter({
      chars: totalChars + len,
      count: contextMessages.length,
      age: msgAge,
      age_h: msgAge / 3_600_000,
      age_m: msgAge / 60_000,
      age_s: msgAge / 1000,
    });
    if (!shouldInclude && contextMessages.length > 0) break;
    contextMessages.push(m.content);
    totalChars += len;
  }

  for (const entity of respondingEntities) {
    if (entity.memoryScope !== "none") {
      const memories = await retrieveRelevantMemories(
        entity.id,
        contextMessages,
        entity.memoryScope as MemoryScope,
        channelId,
        guildId,
      );
      if (memories.length > 0) {
        entityMemories.set(entity.id, memories.map(m => ({ content: m.content })));
        debug("Web: retrieved memories", { entity: entity.name, count: memories.length });
      }
    }
  }

  const msgCtx = {
    channelId,
    guildId,
    userId: "web-user",
    username,
    content,
    isMentioned: true,
    respondingEntities,
    entityMemories,
  };

  // Signal typing for each responding entity
  for (const entity of respondingEntities) {
    broadcastSSE(channelId, {
      type: "typing",
      author_name: entity.name,
      author_id: `entity:${entity.id}`,
      avatar_url: entity.avatarUrl ?? null,
    });
  }

  const streamMode = respondingEntities[0]?.streamMode;
  if (streamMode) {
    // Streaming path: broadcast SSE events as they arrive
    const streamDelimiter = respondingEntities[0]?.streamDelimiter ?? undefined;
    const streamingCtx = {
      ...msgCtx,
      entities: respondingEntities,
      streamMode: streamMode as "full" | "lines",
      delimiter: streamDelimiter,
    };

    // Per-entity accumulator for multi-entity streaming
    const entityBuffers = new Map<string, string>();

    for await (const event of handleMessageStreaming(streamingCtx)) {
      if (event.type === "char_start") {
        entityBuffers.set(event.name, "");
        broadcastSSE(channelId, {
          type: "message_start",
          author_name: event.name,
          author_id: `entity:${event.entityId}`,
          avatar_url: event.avatarUrl,
        });
      } else if (event.type === "char_delta") {
        const prev = entityBuffers.get(event.name) ?? "";
        entityBuffers.set(event.name, prev + event.delta);
        broadcastSSE(channelId, { type: "text_delta", text: event.delta });
      } else if (event.type === "char_line") {
        const prev = entityBuffers.get(event.name) ?? "";
        entityBuffers.set(event.name, prev + event.content + "\n");
        broadcastSSE(channelId, { type: "text_delta", text: event.content + "\n" });
      } else if (event.type === "char_end") {
        const fullContent = entityBuffers.get(event.name) ?? event.content;
        // Find the entity by name to get its ID
        const entityData = respondingEntities.find(e => e.name === event.name);
        if (entityData) {
          const stored = addMessage(channelId, `entity:${entityData.id}`, event.name, fullContent.trim());
          broadcastSSE(channelId, { type: "message_complete", content: fullContent.trim(), message: stored });
        }
        entityBuffers.delete(event.name);
      } else if (event.type === "delta" || event.type === "line") {
        // Single entity (no char_ prefix events); "line" appends a newline
        if (!entityBuffers.has("_single")) {
          entityBuffers.set("_single", "");
          broadcastSSE(channelId, {
            type: "message_start",
            author_name: respondingEntities[0].name,
            author_id: `entity:${respondingEntities[0].id}`,
            avatar_url: respondingEntities[0].avatarUrl,
          });
        }
        const text = event.type === "line" ? event.content + "\n" : event.content;
        entityBuffers.set("_single", (entityBuffers.get("_single") ?? "") + text);
        broadcastSSE(channelId, { type: "text_delta", text });
      } else if (event.type === "done") {
        if (entityBuffers.has("_single")) {
          const fullContent = entityBuffers.get("_single")?.trim() ?? event.fullText;
          const stored = addMessage(
            channelId,
            `entity:${respondingEntities[0].id}`,
            respondingEntities[0].name,
            fullContent,
          );
          broadcastSSE(channelId, { type: "message_complete", content: fullContent, message: stored });
          entityBuffers.delete("_single");
        }
      }
    }
  } else {
    // Non-streaming path: wait for full response, then broadcast
    const result = await handleMessage(msgCtx);
    if (!result) return;

    // Broadcast response per entity (or one message for grouped entities)
    if (result.entityResponses && result.entityResponses.length > 0) {
      for (const er of result.entityResponses) {
        broadcastSSE(channelId, {
          type: "message_start",
          author_name: er.name,
          author_id: `entity:${er.entityId}`,
        });
        const stored = addMessage(channelId, `entity:${er.entityId}`, er.name, er.content);
        broadcastSSE(channelId, { type: "message_complete", content: er.content, message: stored });
      }
    } else {
      const entityName = respondingEntities[0].name;
      const entityId = respondingEntities[0].id;
      broadcastSSE(channelId, {
        type: "message_start",
        author_name: entityName,
        author_id: `entity:${entityId}`,
      });
      const stored = addMessage(channelId, `entity:${entityId}`, entityName, result.response);
      broadcastSSE(channelId, { type: "message_complete", content: result.response, message: stored });
    }
  }
}
