import { generateText } from "ai";
import { getLanguageModel, DEFAULT_MODEL } from "./models";
import { info, debug, error } from "../logger";
import {
  getEntityWithFacts,
  formatEntitiesForContext,
  type EntityWithFacts,
} from "../db/entities";
import {
  resolveDiscordEntity,
  addMessage,
  getMessages,
} from "../db/discord";

// =============================================================================
// Types
// =============================================================================

export interface MessageContext {
  channelId: string;
  guildId?: string;
  userId: string;
  username: string;
  content: string;
  isMentioned: boolean;
}

export interface ResponseResult {
  response: string;
}

// =============================================================================
// Context Building
// =============================================================================

function buildSystemPrompt(entities: EntityWithFacts[]): string {
  if (entities.length === 0) {
    return "You are a helpful assistant. Respond naturally to the user.";
  }
  return formatEntitiesForContext(entities);
}

function buildUserMessage(messages: Array<{ author_name: string; content: string }>): string {
  // Merge messages into single user block with persona prefixes
  return messages.map(m => `${m.author_name}: ${m.content}`).join("\n");
}

// =============================================================================
// Main Handler
// =============================================================================

export async function handleMessage(ctx: MessageContext): Promise<ResponseResult | null> {
  const { channelId, guildId, userId, username, content, isMentioned } = ctx;

  // Store message in history
  addMessage(channelId, userId, username, content);

  // Resolve channel and user entities
  const channelEntityId = resolveDiscordEntity(channelId, "channel", guildId, channelId);
  const userEntityId = resolveDiscordEntity(userId, "user", guildId, channelId);

  // Gather entities for context
  const entities: EntityWithFacts[] = [];

  // Add channel entity if bound
  if (channelEntityId) {
    const channelEntity = getEntityWithFacts(channelEntityId);
    if (channelEntity) {
      entities.push(channelEntity);

      // Check if channel is in a location, add that too
      const locationFact = channelEntity.facts.find(f => f.content.match(/^is in \[entity:(\d+)\]/));
      if (locationFact) {
        const match = locationFact.content.match(/^is in \[entity:(\d+)\]/);
        if (match) {
          const locationEntity = getEntityWithFacts(parseInt(match[1]));
          if (locationEntity) entities.push(locationEntity);
        }
      }
    }
  }

  // Add user entity if bound
  if (userEntityId) {
    const userEntity = getEntityWithFacts(userEntityId);
    if (userEntity) entities.push(userEntity);
  }

  // Decide whether to respond
  // Respond if mentioned OR if there's a channel entity bound
  const shouldRespond = isMentioned || channelEntityId !== null;
  if (!shouldRespond) {
    debug("Not responding - not mentioned and no channel binding");
    return null;
  }

  // Get message history
  const history = getMessages(channelId, 20);

  // Build prompts
  const systemPrompt = buildSystemPrompt(entities);
  const userMessage = buildUserMessage(
    history.slice().reverse().map(m => ({ author_name: m.author_name, content: m.content }))
  );

  debug("Calling LLM", {
    entities: entities.length,
    historyMessages: history.length,
    systemPromptLength: systemPrompt.length,
  });

  try {
    const model = getLanguageModel(DEFAULT_MODEL);

    const result = await generateText({
      model,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    info("LLM response", {
      textLength: result.text.length,
    });

    return {
      response: result.text,
    };
  } catch (err) {
    error("LLM error", err);
    return null;
  }
}
