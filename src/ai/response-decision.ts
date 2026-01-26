import { generateText } from "ai";
import { getLanguageModel } from "./models";
import { debug } from "../logger";

// =============================================================================
// Trigger System
// =============================================================================

export type TriggerCondition =
  | { type: "mention" }
  | { type: "pattern"; regex: RegExp }
  | { type: "random"; chance: number }
  | { type: "llm"; model?: string }
  | { type: "always" };

export type TriggerAction =
  | { type: "respond" }
  | { type: "narrate"; template?: string };

export interface Trigger {
  condition: TriggerCondition;
  action: TriggerAction;
}

export interface TriggerConfig {
  triggers: Trigger[];
  delayMs: number;
  throttleMs: number;
  llmDecideModel: string;
}

export const DEFAULT_TRIGGER_CONFIG: TriggerConfig = {
  triggers: [{ condition: { type: "mention" }, action: { type: "respond" } }],
  delayMs: 0,
  throttleMs: 0,
  llmDecideModel: "google:gemini-2.5-flash-lite-preview-06-2025",
};

// =============================================================================
// Trigger Parsing from Facts
// =============================================================================

/**
 * Parse trigger facts. Format examples:
 *   trigger: mention -> respond
 *   trigger: pattern "hello|hi" -> respond
 *   trigger: random 0.1 -> respond
 *   trigger: llm -> respond
 *   trigger: llm google:gemini-2.5-flash -> respond
 *   trigger: always -> respond
 *   trigger: pattern "^!" -> narrate "A command was issued"
 *   delay_ms: 5000
 *   throttle_ms: 10000
 *   llm_decide_model: google:gemini-2.5-flash-lite
 */
export function parseTriggerConfig(facts: Array<{ content: string }>): TriggerConfig {
  const config: TriggerConfig = {
    triggers: [],
    delayMs: 0,
    throttleMs: 0,
    llmDecideModel: DEFAULT_TRIGGER_CONFIG.llmDecideModel,
  };

  for (const fact of facts) {
    const content = fact.content.trim();

    // Parse trigger facts
    const triggerMatch = content.match(/^trigger:\s*(.+?)\s*->\s*(.+)$/i);
    if (triggerMatch) {
      const conditionStr = triggerMatch[1].trim();
      const actionStr = triggerMatch[2].trim();

      const condition = parseCondition(conditionStr);
      const action = parseAction(actionStr);

      if (condition && action) {
        config.triggers.push({ condition, action });
      }
      continue;
    }

    // Parse config values
    const delayMatch = content.match(/^delay_ms:\s*(\d+)$/i);
    if (delayMatch) {
      config.delayMs = parseInt(delayMatch[1]);
      continue;
    }

    const throttleMatch = content.match(/^throttle_ms:\s*(\d+)$/i);
    if (throttleMatch) {
      config.throttleMs = parseInt(throttleMatch[1]);
      continue;
    }

    const modelMatch = content.match(/^llm_decide_model:\s*(.+)$/i);
    if (modelMatch) {
      config.llmDecideModel = modelMatch[1].trim();
    }
  }

  // Default: respond to mentions if no triggers defined
  if (config.triggers.length === 0) {
    config.triggers = DEFAULT_TRIGGER_CONFIG.triggers;
  }

  return config;
}

function parseCondition(str: string): TriggerCondition | null {
  if (str === "mention") {
    return { type: "mention" };
  }

  if (str === "always") {
    return { type: "always" };
  }

  const patternMatch = str.match(/^pattern\s+"([^"]+)"$/i);
  if (patternMatch) {
    try {
      return { type: "pattern", regex: new RegExp(patternMatch[1], "i") };
    } catch {
      return null;
    }
  }

  const randomMatch = str.match(/^random\s+([\d.]+)$/i);
  if (randomMatch) {
    const chance = parseFloat(randomMatch[1]);
    if (chance >= 0 && chance <= 1) {
      return { type: "random", chance };
    }
    return null;
  }

  const llmMatch = str.match(/^llm(?:\s+(.+))?$/i);
  if (llmMatch) {
    return { type: "llm", model: llmMatch[1]?.trim() };
  }

  return null;
}

function parseAction(str: string): TriggerAction | null {
  if (str === "respond") {
    return { type: "respond" };
  }

  const narrateMatch = str.match(/^narrate(?:\s+"([^"]+)")?$/i);
  if (narrateMatch) {
    return { type: "narrate", template: narrateMatch[1] };
  }

  return null;
}

// =============================================================================
// Trigger Evaluation
// =============================================================================

export interface TriggerContext {
  isMentioned: boolean;
  content: string;
  characterName: string;
  recentMessages: Array<{ authorName: string; content: string }>;
}

export async function evaluateTriggers(
  config: TriggerConfig,
  ctx: TriggerContext
): Promise<TriggerAction | null> {
  for (const trigger of config.triggers) {
    const fired = await evaluateCondition(trigger.condition, ctx, config);
    if (fired) {
      debug("Trigger fired", { condition: trigger.condition.type, action: trigger.action.type });
      return trigger.action;
    }
  }
  return null;
}

async function evaluateCondition(
  condition: TriggerCondition,
  ctx: TriggerContext,
  config: TriggerConfig
): Promise<boolean> {
  switch (condition.type) {
    case "mention":
      return ctx.isMentioned;

    case "always":
      return true;

    case "pattern":
      return condition.regex.test(ctx.content);

    case "random":
      return Math.random() < condition.chance;

    case "llm": {
      const model = condition.model ?? config.llmDecideModel;
      return shouldRespondLlm(model, ctx.characterName, ctx.recentMessages);
    }
  }
}

// =============================================================================
// Message Buffer (for delay)
// =============================================================================

interface BufferedMessages {
  messages: Array<{ authorName: string; content: string; timestamp: number }>;
  timer: ReturnType<typeof setTimeout> | null;
  lastResponseTime: number;
}

const channelBuffers = new Map<string, BufferedMessages>();

export function getOrCreateBuffer(channelId: string): BufferedMessages {
  let buffer = channelBuffers.get(channelId);
  if (!buffer) {
    buffer = {
      messages: [],
      timer: null,
      lastResponseTime: 0,
    };
    channelBuffers.set(channelId, buffer);
  }
  return buffer;
}

export function addToBuffer(
  channelId: string,
  authorName: string,
  content: string
): void {
  const buffer = getOrCreateBuffer(channelId);
  buffer.messages.push({
    authorName,
    content,
    timestamp: Date.now(),
  });

  // Limit buffer size
  if (buffer.messages.length > 50) {
    buffer.messages = buffer.messages.slice(-50);
  }
}

export function getBufferedMessages(channelId: string): Array<{ authorName: string; content: string }> {
  const buffer = channelBuffers.get(channelId);
  return buffer?.messages.map(m => ({ authorName: m.authorName, content: m.content })) ?? [];
}

export function clearBuffer(channelId: string): void {
  const buffer = channelBuffers.get(channelId);
  if (buffer) {
    buffer.messages = [];
  }
}

export function setBufferTimer(
  channelId: string,
  callback: () => void,
  delayMs: number
): void {
  const buffer = getOrCreateBuffer(channelId);

  // Clear existing timer
  if (buffer.timer) {
    clearTimeout(buffer.timer);
  }

  buffer.timer = setTimeout(() => {
    buffer.timer = null;
    callback();
  }, delayMs);
}

export function hasActiveTimer(channelId: string): boolean {
  const buffer = channelBuffers.get(channelId);
  return buffer?.timer !== null;
}

// =============================================================================
// Throttling
// =============================================================================

export function canRespondThrottle(channelId: string, throttleMs: number): boolean {
  if (throttleMs <= 0) return true;

  const buffer = getOrCreateBuffer(channelId);
  const now = Date.now();
  return now - buffer.lastResponseTime >= throttleMs;
}

export function markResponseTime(channelId: string): void {
  const buffer = getOrCreateBuffer(channelId);
  buffer.lastResponseTime = Date.now();
}

export function getThrottleRemainingMs(channelId: string, throttleMs: number): number {
  if (throttleMs <= 0) return 0;

  const buffer = channelBuffers.get(channelId);
  if (!buffer) return 0;

  const elapsed = Date.now() - buffer.lastResponseTime;
  return Math.max(0, throttleMs - elapsed);
}

// =============================================================================
// LLM Decision
// =============================================================================

export async function shouldRespondLlm(
  modelSpec: string,
  characterName: string,
  recentMessages: Array<{ authorName: string; content: string }>
): Promise<boolean> {
  if (recentMessages.length === 0) return false;

  const messagesText = recentMessages
    .map(m => `${m.authorName}: ${m.content}`)
    .join("\n");

  const prompt = `You are deciding whether "${characterName}" should respond to this conversation.

Recent messages:
${messagesText}

Should ${characterName} respond? Consider:
- Is the conversation directed at or about ${characterName}?
- Would it be natural for ${characterName} to join in?
- Is there something ${characterName} would want to say?

Answer with just "yes" or "no".`;

  try {
    const model = getLanguageModel(modelSpec);
    const result = await generateText({
      model,
      messages: [{ role: "user", content: prompt }],
      maxOutputTokens: 10,
    });

    const answer = result.text.toLowerCase().trim();
    const shouldRespond = answer.startsWith("yes");

    debug("LLM response decision", {
      model: modelSpec,
      character: characterName,
      messagesCount: recentMessages.length,
      answer,
      shouldRespond,
    });

    return shouldRespond;
  } catch (err) {
    debug("LLM response decision failed, defaulting to no", { error: String(err) });
    return false;
  }
}
