import type { ModelMessage, TextPart, ImagePart, FilePart } from "ai";
import type { CollapseRoles, ContentFilter, ExprContext, ThinkingLevel } from "../logic/expr";

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
  /** Pre-evaluated responding entities (facts already processed) */
  respondingEntities?: EvaluatedEntity[];
  /** Retrieved memories per entity (entity id -> memories) */
  entityMemories?: Map<number, Array<{ content: string }>>;
}

/** Entity with pre-evaluated facts (directives processed and removed) */
export interface EvaluatedEntity {
  id: number;
  name: string;
  /** Facts with directives ($if, $respond, $avatar, etc.) processed and removed */
  facts: string[];
  /** Avatar URL from $avatar directive, if present */
  avatarUrl: string | null;
  /** Stream mode from $stream directive, if present */
  streamMode: "lines" | "full" | null;
  /** Custom delimiters for streaming (default: newline) */
  streamDelimiter: string[] | null;
  /** Memory retrieval scope from $memory directive (default: "none") */
  memoryScope: "none" | "channel" | "guild" | "global";
  /** Context expression from $context directive (e.g. "chars < 16000"), if present */
  contextExpr: string | null;
  /** Freeform multi-char responses (no XML parsing) from $freeform directive */
  isFreeform: boolean;
  /** Model spec from $model directive (e.g. "google:gemini-2.0-flash") */
  modelSpec: string | null;
  /** Strip patterns from $strip directive. null = no directive (use default), [] = explicit no-strip */
  stripPatterns: string[] | null;
  /** Thinking level from $thinking directive. null = no directive (use default) */
  thinkingLevel: ThinkingLevel | null;
  /** Which roles to collapse adjacent messages for. null = no directive (default: all roles) */
  collapseMessages: CollapseRoles | null;
  /** Per-category content filter overrides (from $safety directives). Empty = use provider defaults */
  contentFilters: ContentFilter[];
  /** Custom system prompt template (null = use default formatting) */
  template: string | null;
  /** Custom system prompt for AI SDK `system` parameter (null = use global default) */
  systemTemplate: string | null;
  /** Expression context used during fact evaluation (carried to macro expansion) */
  exprContext?: ExprContext;
}

// =============================================================================
// Constants
// =============================================================================

/** Apply strip patterns to text, removing all occurrences of each pattern */
export function applyStripPatterns(text: string, patterns: string[]): string {
  let result = text;
  for (const pattern of patterns) {
    result = result.replaceAll(pattern, "");
  }
  return result;
}

/** Default context expression when no $context directive is present */
export const DEFAULT_CONTEXT_EXPR = "chars < 4000 || count < 20";

/** Hard cap on context size (~250k tokens) */
export const MAX_CONTEXT_CHAR_LIMIT = 1_000_000;

// =============================================================================
// Formatting
// =============================================================================

/** Format entity name and ID for LLM context */
export function formatEntityDisplay(name: string, id: number): string {
  return `${name} [${id}]`;
}

/** Format an evaluated entity for LLM context */
export function formatEvaluatedEntity(entity: EvaluatedEntity): string {
  const factLines = entity.facts.join("\n");
  return `<defs for="${entity.name}" id="${entity.id}">\n${factLines}\n</defs>`;
}

// =============================================================================
// Structured Messages (Role-Based)
// =============================================================================

export interface StructuredMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// =============================================================================
// Multimodal Content Parts
// =============================================================================

// Re-export AI SDK types directly — no parallel definitions to diverge from the schema.
export type { TextPart, ImagePart, FilePart };
export type ContentPart = TextPart | ImagePart | FilePart;

/** Message after attachment markers have been resolved to content parts */
export type ResolvedMessage = {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
};

// =============================================================================
// Provider-Specific Message Normalization
// =============================================================================

/**
 * Normalize messages for providers with system message restrictions.
 *
 * Google/Gemini: The messages array doesn't support system role at all - Gemini
 * only has user/model roles. The separate `system` parameter (system instruction)
 * is handled differently by the SDK. Convert all system-role messages to user-role.
 *
 * @param messages - The structured messages array
 * @param providerName - The provider name (e.g. "google", "anthropic")
 * @returns Normalized messages array
 */
export function normalizeMessagesForProvider(
  messages: ResolvedMessage[],
  providerName: string
): ModelMessage[] {
  // Only Google requires this normalization
  if (providerName !== "google" && providerName !== "google-vertex") {
    return messages as ModelMessage[];
  }

  // Check if there are any system messages
  const hasSystemMessage = messages.some(m => m.role === "system");
  if (!hasSystemMessage) {
    return messages as ModelMessage[];
  }

  // Convert all system messages to user messages
  return messages.map(msg => {
    if (msg.role === "system") {
      return { ...msg, role: "user" as const };
    }
    return msg;
  }) as ModelMessage[];
}
