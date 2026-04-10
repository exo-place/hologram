/**
 * Restricted JavaScript expression evaluator for $if conditional facts.
 *
 * Expressions are boolean JS with safe globals:
 *   $if random() < 0.3: has fox ears
 *   $if has_fact("poisoned") && random() < 0.5: takes damage
 *   $if time.is_night: glows faintly
 *   $if self.fox_tf >= 0.5: has full fur
 */

import { MAX_CONTEXT_CHAR_LIMIT } from "../ai/context";
import { ExprError, Tokenizer, Parser, compileExpr, evalExpr, compileTemplateExpr, evalMacroValue, evalRaw } from "./expr-compiler";
import { parseSelfContext, createBaseContext, checkKeywordMatch, checkMentionedInDialogue, rollDice, formatDuration, parseOffset, type BaseContextOptions } from "./expr-context";

// =============================================================================
// Types
// =============================================================================

/** Parsed fact values accessible via self.* in expressions */
export type SelfContext = Record<string, string | number | boolean>;

/**
 * Safe Date wrapper for sandboxed expressions.
 *
 * Exposes Date constructor and static methods without allowing prototype chain escapes.
 * All properties are frozen and use Object.create(null) for nested objects.
 */
export interface SafeDate {
  /** Create a Date from no args (now), timestamp (ms), date string, or components */
  new: (...args: unknown[]) => Date;
  /** Current timestamp in milliseconds since Unix epoch */
  now: () => number;
  /** Parse a date string, returns timestamp in ms or NaN if invalid */
  parse: (dateString: string) => number;
  /** Create UTC timestamp from year, month, and optional day/hour/min/sec/ms */
  UTC: (year: number, monthIndex?: number, date?: number, hours?: number, minutes?: number, seconds?: number, ms?: number) => number;
}

export interface ExprContext {
  /** Entity's own parsed fact values (from "key: value" facts) */
  self: SelfContext;
  /** Returns random float [0,1), or random int [1,max] or [min,max]. */
  random: (min?: number, max?: number) => number;
  /** Check if entity has a fact matching pattern */
  has_fact: (pattern: string) => boolean;
  /** Roll dice expression (e.g. "2d6+3"), returns total */
  roll: (dice: string) => number;
  /** Current time info */
  time: {
    hour: number;
    is_day: boolean;
    is_night: boolean;
  };
  /** Milliseconds since last response in channel */
  response_ms: number;
  /** Milliseconds since triggering message (for $retry re-evaluation) */
  retry_ms: number;
  /** Milliseconds since any message in channel */
  idle_ms: number;
  /** Number of messages in channel since this entity's last reply */
  unread_count: number;
  /** Whether the bot was @mentioned */
  mentioned: boolean;
  /** Whether the message is a reply to the bot */
  replied: boolean;
  /** Name of entity that was replied to (empty if not a webhook reply) */
  replied_to: string;
  /** Whether the message is a forwarded message */
  is_forward: boolean;
  /** Whether the message is from this entity's own webhook (self-triggered) */
  is_self: boolean;
  /** Whether the message is from any hologram entity (our webhook) */
  is_hologram: boolean;
  silent: boolean;
  /** Check if a name is mentioned in dialogue (excludes XML tags like <Name>) */
  mentioned_in_dialogue: (name: string) => boolean;
  /** Message content (alias for messages(1, "%m")) */
  content: string;
  /** Message author (alias for messages(1, "%a")) */
  author: string;
  /** Interaction type if applicable (drink, eat, throw, etc.) */
  interaction_type?: string;
  /** This entity's name */
  name: string;
  /** Names of all characters bound to channel */
  chars: string[];
  /** Get the last N messages from the channel. Format: %a=author, %m=message (default "%a: %m"). Filter: "user", "char", or name. */
  messages: (n?: number, format?: string, filter?: string) => string;
  /** Comma-separated names of all characters bound to channel */
  group: string;
  /** Format a duration in ms as human-readable string */
  duration: (ms: number) => string;
  /** Date string, e.g. "Thu Jan 30 2026", with optional offset */
  date_str: (offset?: string) => string;
  /** Time string, e.g. "6:00 PM", with optional offset */
  time_str: (offset?: string) => string;
  /** ISO date "2026-01-30", with optional offset */
  isodate: (offset?: string) => string;
  /** ISO time "18:00", with optional offset */
  isotime: (offset?: string) => string;
  /** Weekday name "Thursday", with optional offset */
  weekday: (offset?: string) => string;
  /** Pick a random element from an array */
  pick: <T>(arr: T[]) => T | undefined;
  /**
   * Safe Date constructor and static methods.
   * - Date.new() or Date.new(timestamp) or Date.new(dateString) or Date.new(year, month, ...)
   * - Date.now() returns current timestamp in ms
   * - Date.parse(string) parses date string to timestamp
   * - Date.UTC(...) creates UTC timestamp from components
   */
  Date: SafeDate;
  /** Channel metadata */
  channel: {
    id: string;
    name: string;
    description: string;
    is_nsfw: boolean;
    /** Channel type: "text" | "vc" | "thread" | "forum" | "announcement" | "dm" | "category" | "directory" | "media" */
    type: string;
    mention: string;
  };
  /** Server metadata */
  server: {
    id: string;
    name: string;
    description: string;
    /** Guild NSFW level: "default" | "explicit" | "safe" | "age_restricted" */
    nsfw_level: string;
  };
  /** Whether the message matched any of the entity's configured trigger keywords */
  keyword_match: boolean;
  /** Additional context-specific variables */
  [key: string]: unknown;
}

// Tokenizer, Parser, compile/eval functions, and ExprError live in expr-compiler.ts
// Context factory and utilities (createBaseContext, rollDice, etc.) live in expr-context.ts

// =============================================================================
// Comment Stripping
// =============================================================================

/**
 * Strip comments from facts.
 * Comments are lines starting with $# in the FIRST column only.
 * Lines starting with space then $# are NOT comments (escape mechanism).
 */
export function stripComments(facts: string[]): string[] {
  return facts.filter((fact) => !fact.startsWith("$#"));
}

// =============================================================================
// Fact Processing
// =============================================================================

const IF_SIGIL = "$if ";
const RESPOND_SIGIL = "$respond";
const RETRY_SIGIL = "$retry ";
const AVATAR_SIGIL = "$avatar ";
const LOCKED_SIGIL = "$locked";
const STREAM_SIGIL = "$stream";
const MEMORY_SIGIL = "$memory";
const CONTEXT_SIGIL = "$context";
const FREEFORM_SIGIL = "$freeform";
const MODEL_SIGIL = "$model ";
const STRIP_SIGIL = "$strip";
const THINKING_SIGIL = "$thinking";
const COLLAPSE_SIGIL = "$collapse";
const SAFETY_SIGIL = "$safety";
const TICK_SIGIL = "$tick ";

/** Memory retrieval scope */
export type MemoryScope = "none" | "channel" | "guild" | "global";

/** Which message roles are eligible for adjacent-message collapsing */
export type CollapseRoles = Set<"user" | "assistant" | "system">;

/** Thinking level for Google models */
export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

/** Content safety filter category (provider-agnostic) */
export type SafetyCategory = "sexual" | "hate" | "harassment" | "dangerous" | "civic";

/** Content safety filter threshold (provider-agnostic).
 * Maps to provider thresholds: off=OFF, none=BLOCK_NONE, low=BLOCK_LOW_AND_ABOVE,
 * medium=BLOCK_MEDIUM_AND_ABOVE, high=BLOCK_ONLY_HIGH */
export type SafetyThreshold = "off" | "none" | "low" | "medium" | "high";

/** A per-category content filter override */
export interface ContentFilter {
  category: SafetyCategory;
  threshold: SafetyThreshold;
}

const ALL_SAFETY_CATEGORIES: SafetyCategory[] = ["sexual", "hate", "harassment", "dangerous", "civic"];
const SAFETY_CATEGORY_SET = new Set<string>(ALL_SAFETY_CATEGORIES);
/** Threshold keywords that are not valid expression identifiers — handled as literals */
const SAFETY_THRESHOLD_KEYWORDS = new Set(["off", "none", "low", "medium", "high"]);

export interface ProcessedFact {
  content: string;
  conditional: boolean;
  expression?: string;
  /** True if this fact is a $respond directive */
  isRespond: boolean;
  /** For $respond directives, whether to respond (true) or suppress (false) */
  respondValue?: boolean;
  /** True if this fact is a $retry directive */
  isRetry: boolean;
  /** For $retry directives, the delay in milliseconds */
  retryMs?: number;
  /** True if this fact is a $avatar directive */
  isAvatar: boolean;
  /** For $avatar directives, the URL */
  avatarUrl?: string;
  /** True if this is a pure $locked directive (locks entire entity) */
  isLockedDirective: boolean;
  /** True if this fact has $locked prefix (fact is locked but still visible) */
  isLockedFact: boolean;
  /** True if this fact is a $stream directive */
  isStream: boolean;
  /** For $stream directives, the mode */
  streamMode?: "lines" | "full";
  /** For $stream directives with custom delimiters (default: newline) */
  streamDelimiter?: string[];
  /** True if this fact is a $memory directive */
  isMemory: boolean;
  /** For $memory directives, the scope */
  memoryScope?: MemoryScope;
  /** True if this fact is a $context directive */
  isContext: boolean;
  /** For $context directives, the expression string (e.g. "chars < 16000") */
  contextExpr?: string;
  /** True if this fact is a $freeform directive */
  isFreeform: boolean;
  /** True if this fact is a $model directive */
  isModel: boolean;
  /** For $model directives, the model spec (e.g. "google:gemini-2.0-flash") */
  modelSpec?: string;
  /** True if this fact is a $strip directive */
  isStrip: boolean;
  /** For $strip directives, the patterns to strip */
  stripPatterns?: string[];
  /** True if this fact is a $thinking directive */
  isThinking: boolean;
  /** For $thinking directives, the level */
  thinkingLevel?: ThinkingLevel;
  /** True if this fact is a $collapse directive */
  isCollapse: boolean;
  /** For $collapse directives, the set of roles whose adjacent messages should be collapsed */
  collapseRoles?: CollapseRoles;
  /** True if this fact is a $safety directive */
  isSafety: boolean;
  /** For $safety directives, the category ("all" = applies to all categories) */
  safetyCategory?: SafetyCategory | "all";
  /** For $safety directives, the expression string (threshold keyword or boolean expr) */
  safetyExpr?: string;
}

/** Parse expression, expect ':', return position after ':' */
/** Parse expression lazily, expect ':', return position after ':' */
function parseCondition(str: string): number {
  // Use lazy tokenization to avoid parsing content after the colon.
  // This prevents "Unterminated string" errors when content contains apostrophes.
  const tokenizer = new Tokenizer(str);
  const parser = new Parser(tokenizer);
  const { token, pos } = parser.parseExprLazy();
  if (token.type !== "operator" || token.value !== ":") {
    throw new ExprError(`Expected ':'`);
  }
  return pos + 1;
}

/**
 * Parse a fact, detecting $if prefix, $respond, $retry, $locked directives.
 */
export function parseFact(fact: string): ProcessedFact {
  const trimmed = fact.trim();

  // Check for $locked directive or prefix
  const lockedResult = parseLockedDirective(trimmed);
  if (lockedResult !== null) {
    if (lockedResult.isDirective) {
      // Pure $locked directive - locks entire entity
      return {
        content: trimmed,
        conditional: false,
        isRespond: false,
        isRetry: false,
        isAvatar: false,
        isLockedDirective: true,
        isLockedFact: false,
        isStream: false,
        isMemory: false,
        isContext: false,
        isFreeform: false,
        isModel: false,
        isStrip: false,
        isThinking: false,
        isCollapse: false,
        isSafety: false,
      };
    } else {
      // $locked prefix - recursively parse the rest, then mark as locked
      const inner = parseFact(lockedResult.content);
      inner.isLockedFact = true;
      return inner;
    }
  }

  if (trimmed.startsWith(IF_SIGIL)) {
    const rest = trimmed.slice(IF_SIGIL.length);
    const colonEnd = parseCondition(rest);
    const expression = rest.slice(0, colonEnd - 1).trim();
    const content = rest.slice(colonEnd).trim();

    // Check if content is a $respond directive
    const respondResult = parseRespondDirective(content);
    if (respondResult !== null) {
      return {
        content,
        conditional: true,
        expression,
        isRespond: true,
        respondValue: respondResult,
        isRetry: false,
        isAvatar: false,
        isLockedDirective: false,
        isLockedFact: false,
        isStream: false,
        isMemory: false,
        isContext: false,
        isFreeform: false,
        isModel: false,
        isStrip: false,
        isThinking: false,
        isCollapse: false,
        isSafety: false,
      };
    }

    // Check if content is a $retry directive
    const retryResult = parseRetryDirective(content);
    if (retryResult !== null) {
      return {
        content,
        conditional: true,
        expression,
        isRespond: false,
        isRetry: true,
        retryMs: retryResult,
        isAvatar: false,
        isLockedDirective: false,
        isLockedFact: false,
        isStream: false,
        isMemory: false,
        isContext: false,
        isFreeform: false,
        isModel: false,
        isStrip: false,
        isThinking: false,
        isCollapse: false,
        isSafety: false,
      };
    }

    // Check if content is a $stream directive
    const streamResultCond = parseStreamDirective(content);
    if (streamResultCond !== null) {
      return {
        content,
        conditional: true,
        expression,
        isRespond: false,
        isRetry: false,
        isAvatar: false,
        isLockedDirective: false,
        isLockedFact: false,
        isStream: true,
        streamMode: streamResultCond.mode,
        streamDelimiter: streamResultCond.delimiter,
        isMemory: false,
        isContext: false,
        isFreeform: false,
        isModel: false,
        isStrip: false,
        isThinking: false,
        isCollapse: false,
        isSafety: false,
      };
    }

    // Check if content is a $memory directive
    const memoryResultCond = parseMemoryDirective(content);
    if (memoryResultCond !== null) {
      return {
        content,
        conditional: true,
        expression,
        isRespond: false,
        isRetry: false,
        isAvatar: false,
        isLockedDirective: false,
        isLockedFact: false,
        isStream: false,
        isMemory: true,
        memoryScope: memoryResultCond,
        isContext: false,
        isFreeform: false,
        isModel: false,
        isStrip: false,
        isThinking: false,
        isCollapse: false,
        isSafety: false,
      };
    }

    // Check if content is a $context directive
    const contextResultCond = parseContextDirective(content);
    if (contextResultCond !== null) {
      return {
        content,
        conditional: true,
        expression,
        isRespond: false,
        isRetry: false,
        isAvatar: false,
        isLockedDirective: false,
        isLockedFact: false,
        isStream: false,
        isMemory: false,
        isContext: true,
        contextExpr: contextResultCond,
        isFreeform: false,
        isModel: false,
        isStrip: false,
        isThinking: false,
        isCollapse: false,
        isSafety: false,
      };
    }

    // Check if content is a $freeform directive
    if (content === FREEFORM_SIGIL) {
      return {
        content,
        conditional: true,
        expression,
        isRespond: false,
        isRetry: false,
        isAvatar: false,
        isLockedDirective: false,
        isLockedFact: false,
        isStream: false,
        isMemory: false,
        isContext: false,
        isFreeform: true,
        isModel: false,
        isStrip: false,
        isThinking: false,
        isCollapse: false,
        isSafety: false,
      };
    }

    // Check if content is a $model directive
    const modelResultCond = parseModelDirective(content);
    if (modelResultCond !== null) {
      return {
        content,
        conditional: true,
        expression,
        isRespond: false,
        isRetry: false,
        isAvatar: false,
        isLockedDirective: false,
        isLockedFact: false,
        isStream: false,
        isMemory: false,
        isContext: false,
        isFreeform: false,
        isModel: true,
        modelSpec: modelResultCond,
        isStrip: false,
        isThinking: false,
        isCollapse: false,
        isSafety: false,
      };
    }

    // Check if content is a $strip directive
    const stripResultCond = parseStripDirective(content);
    if (stripResultCond !== null) {
      return {
        content,
        conditional: true,
        expression,
        isRespond: false,
        isRetry: false,
        isAvatar: false,
        isLockedDirective: false,
        isLockedFact: false,
        isStream: false,
        isMemory: false,
        isContext: false,
        isFreeform: false,
        isModel: false,
        isStrip: true,
        stripPatterns: stripResultCond,
        isThinking: false,
        isCollapse: false,
        isSafety: false,
      };
    }

    // Check if content is a $thinking directive
    const thinkingResultCond = parseThinkingDirective(content);
    if (thinkingResultCond !== null) {
      return {
        content,
        conditional: true,
        expression,
        isRespond: false,
        isRetry: false,
        isAvatar: false,
        isLockedDirective: false,
        isLockedFact: false,
        isStream: false,
        isMemory: false,
        isContext: false,
        isFreeform: false,
        isModel: false,
        isStrip: false,
        isThinking: true,
        isCollapse: false,
        isSafety: false,
        thinkingLevel: thinkingResultCond,
      };
    }

    // Check if content is a $collapse directive
    const collapseResultCond = parseCollapseDirective(content);
    if (collapseResultCond !== null) {
      return {
        content,
        conditional: true,
        expression,
        isRespond: false,
        isRetry: false,
        isAvatar: false,
        isLockedDirective: false,
        isLockedFact: false,
        isStream: false,
        isMemory: false,
        isContext: false,
        isFreeform: false,
        isModel: false,
        isStrip: false,
        isThinking: false,
        isCollapse: true,
        collapseRoles: collapseResultCond,
        isSafety: false,
      };
    }

    // Check if content is a $safety directive
    const safetyResultCond = parseSafetyDirective(content);
    if (safetyResultCond !== null) {
      return {
        content,
        conditional: true,
        expression,
        isRespond: false,
        isRetry: false,
        isAvatar: false,
        isLockedDirective: false,
        isLockedFact: false,
        isStream: false,
        isMemory: false,
        isContext: false,
        isFreeform: false,
        isModel: false,
        isStrip: false,
        isThinking: false,
        isCollapse: false,
        isSafety: true,
        safetyCategory: safetyResultCond.category,
        safetyExpr: safetyResultCond.expr,
      };
    }

    return { content, conditional: true, expression, isRespond: false, isRetry: false, isAvatar: false, isLockedDirective: false, isLockedFact: false, isStream: false, isMemory: false, isContext: false, isFreeform: false, isModel: false, isStrip: false, isCollapse: false, isThinking: false, isSafety: false };
  }

  // Check for unconditional $respond
  const respondResult = parseRespondDirective(trimmed);
  if (respondResult !== null) {
    return {
      content: trimmed,
      conditional: false,
      isRespond: true,
      respondValue: respondResult,
      isRetry: false,
      isAvatar: false,
      isLockedDirective: false,
      isLockedFact: false,
      isStream: false,
      isMemory: false,
      isContext: false,
      isFreeform: false,
      isModel: false,
      isStrip: false,
      isThinking: false,
      isCollapse: false,
      isSafety: false,
    };
  }

  // Check for unconditional $retry
  const retryResult = parseRetryDirective(trimmed);
  if (retryResult !== null) {
    return {
      content: trimmed,
      conditional: false,
      isRespond: false,
      isRetry: true,
      retryMs: retryResult,
      isAvatar: false,
      isLockedDirective: false,
      isLockedFact: false,
      isStream: false,
      isMemory: false,
      isContext: false,
      isFreeform: false,
      isModel: false,
      isStrip: false,
      isThinking: false,
      isCollapse: false,
      isSafety: false,
    };
  }

  // Check for $avatar
  const avatarResult = parseAvatarDirective(trimmed);
  if (avatarResult !== null) {
    return {
      content: trimmed,
      conditional: false,
      isRespond: false,
      isRetry: false,
      isAvatar: true,
      avatarUrl: avatarResult,
      isLockedDirective: false,
      isLockedFact: false,
      isStream: false,
      isMemory: false,
      isContext: false,
      isFreeform: false,
      isModel: false,
      isStrip: false,
      isThinking: false,
      isCollapse: false,
      isSafety: false,
    };
  }

  // Check for unconditional $stream
  const streamResult = parseStreamDirective(trimmed);
  if (streamResult !== null) {
    return {
      content: trimmed,
      conditional: false,
      isRespond: false,
      isRetry: false,
      isAvatar: false,
      isLockedDirective: false,
      isLockedFact: false,
      isStream: true,
      streamMode: streamResult.mode,
      streamDelimiter: streamResult.delimiter,
      isMemory: false,
      isContext: false,
      isFreeform: false,
      isModel: false,
      isStrip: false,
      isThinking: false,
      isCollapse: false,
      isSafety: false,
    };
  }

  // Check for unconditional $memory
  const memoryResult = parseMemoryDirective(trimmed);
  if (memoryResult !== null) {
    return {
      content: trimmed,
      conditional: false,
      isRespond: false,
      isRetry: false,
      isAvatar: false,
      isLockedDirective: false,
      isLockedFact: false,
      isStream: false,
      isMemory: true,
      memoryScope: memoryResult,
      isContext: false,
      isFreeform: false,
      isModel: false,
      isStrip: false,
      isThinking: false,
      isCollapse: false,
      isSafety: false,
    };
  }

  // Check for unconditional $context
  const contextResult = parseContextDirective(trimmed);
  if (contextResult !== null) {
    return {
      content: trimmed,
      conditional: false,
      isRespond: false,
      isRetry: false,
      isAvatar: false,
      isLockedDirective: false,
      isLockedFact: false,
      isStream: false,
      isMemory: false,
      isContext: true,
      contextExpr: contextResult,
      isFreeform: false,
      isModel: false,
      isStrip: false,
      isThinking: false,
      isCollapse: false,
      isSafety: false,
    };
  }

  // Check for unconditional $freeform
  if (trimmed === FREEFORM_SIGIL) {
    return {
      content: trimmed,
      conditional: false,
      isRespond: false,
      isRetry: false,
      isAvatar: false,
      isLockedDirective: false,
      isLockedFact: false,
      isStream: false,
      isMemory: false,
      isContext: false,
        isFreeform: true,
        isModel: false,
        isStrip: false,
        isThinking: false,
        isCollapse: false,
        isSafety: false,
      };
  }

  // Check for unconditional $model
  const modelResult = parseModelDirective(trimmed);
  if (modelResult !== null) {
    return {
      content: trimmed,
      conditional: false,
      isRespond: false,
      isRetry: false,
      isAvatar: false,
      isLockedDirective: false,
      isLockedFact: false,
      isStream: false,
      isMemory: false,
      isContext: false,
      isFreeform: false,
      isModel: true,
      modelSpec: modelResult,
      isStrip: false,
      isThinking: false,
      isCollapse: false,
      isSafety: false,
    };
  }

  // Check for unconditional $strip
  const stripResult = parseStripDirective(trimmed);
  if (stripResult !== null) {
    return {
      content: trimmed,
      conditional: false,
      isRespond: false,
      isRetry: false,
      isAvatar: false,
      isLockedDirective: false,
      isLockedFact: false,
      isStream: false,
      isMemory: false,
      isContext: false,
      isFreeform: false,
      isModel: false,
      isStrip: true,
      stripPatterns: stripResult,
      isThinking: false,
      isCollapse: false,
      isSafety: false,
    };
  }

  // Check for unconditional $thinking
  const thinkingResult = parseThinkingDirective(trimmed);
  if (thinkingResult !== null) {
    return {
      content: trimmed,
      conditional: false,
      isRespond: false,
      isRetry: false,
      isAvatar: false,
      isLockedDirective: false,
      isLockedFact: false,
      isStream: false,
      isMemory: false,
      isContext: false,
      isFreeform: false,
      isModel: false,
      isStrip: false,
      isThinking: true,
      isCollapse: false,
      isSafety: false,
      thinkingLevel: thinkingResult,
    };
  }

  // Check for unconditional $collapse
  const collapseResult = parseCollapseDirective(trimmed);
  if (collapseResult !== null) {
    return {
      content: trimmed,
      conditional: false,
      isRespond: false,
      isRetry: false,
      isAvatar: false,
      isLockedDirective: false,
      isLockedFact: false,
      isStream: false,
      isMemory: false,
      isContext: false,
      isFreeform: false,
      isModel: false,
      isStrip: false,
      isThinking: false,
      isCollapse: true,
      collapseRoles: collapseResult,
      isSafety: false,
    };
  }

  // Check for unconditional $safety directive
  const safetyResult = parseSafetyDirective(trimmed);
  if (safetyResult !== null) {
    return {
      content: trimmed,
      conditional: false,
      isRespond: false,
      isRetry: false,
      isAvatar: false,
      isLockedDirective: false,
      isLockedFact: false,
      isStream: false,
      isMemory: false,
      isContext: false,
      isFreeform: false,
      isModel: false,
      isStrip: false,
      isThinking: false,
      isCollapse: false,
      isSafety: true,
      safetyCategory: safetyResult.category,
      safetyExpr: safetyResult.expr,
    };
  }

  return { content: trimmed, conditional: false, isRespond: false, isRetry: false, isAvatar: false, isLockedDirective: false, isLockedFact: false, isStream: false, isMemory: false, isContext: false, isFreeform: false, isModel: false, isStrip: false, isCollapse: false, isThinking: false, isSafety: false };
}

/**
 * Parse a $respond directive.
 * Returns null if not a respond directive, true for $respond / $respond true, false for $respond false.
 */
function parseRespondDirective(content: string): boolean | null {
  if (!content.startsWith(RESPOND_SIGIL)) {
    return null;
  }
  const rest = content.slice(RESPOND_SIGIL.length).trim().toLowerCase();
  if (rest === "" || rest === "true") {
    return true;
  }
  if (rest === "false") {
    return false;
  }
  // Not a valid $respond directive (might be $respond_to_something or similar)
  return null;
}

/**
 * Parse a $retry directive.
 * Returns null if not a retry directive, or the delay in ms.
 */
function parseRetryDirective(content: string): number | null {
  if (!content.startsWith(RETRY_SIGIL)) {
    return null;
  }
  const rest = content.slice(RETRY_SIGIL.length).trim();
  const ms = parseInt(rest);
  if (isNaN(ms) || ms < 0) {
    return null;
  }
  return ms;
}

/**
 * Parse a $tick directive.
 * Returns null if not a tick directive, or the interval in ms.
 *
 * Supports:
 *   $tick 30000   → 30000ms
 *   $tick 30s     → 30000ms
 *   $tick 5m      → 300000ms
 *   $tick 1h      → 3600000ms
 *   $tick 1d      → 86400000ms
 */
function parseTickDirective(content: string): number | null {
  if (!content.startsWith(TICK_SIGIL)) {
    return null;
  }
  const rest = content.slice(TICK_SIGIL.length).trim();
  if (!rest) return null;
  const match = rest.match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  if (isNaN(value) || value <= 0) return null;
  const unit = match[2] ?? "ms";
  const multipliers: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return Math.round(value * multipliers[unit]);
}

/**
 * Parse a $avatar directive.
 * Returns null if not an avatar directive, or the URL.
 */
function parseAvatarDirective(content: string): string | null {
  if (!content.startsWith(AVATAR_SIGIL)) {
    return null;
  }
  const url = content.slice(AVATAR_SIGIL.length).trim();
  if (!url) {
    return null;
  }
  return url;
}

/**
 * Parse a $locked directive or prefix.
 * Returns null if not a locked directive.
 * Returns { isDirective: true } for pure "$locked" (locks entity).
 * Returns { isDirective: false, content: "..." } for "$locked <fact>" (locks that fact).
 */
function parseLockedDirective(content: string): { isDirective: true } | { isDirective: false; content: string } | null {
  if (!content.startsWith(LOCKED_SIGIL)) {
    return null;
  }
  const rest = content.slice(LOCKED_SIGIL.length);
  // Pure $locked directive (nothing after, or just whitespace)
  if (rest.trim() === "") {
    return { isDirective: true };
  }
  // $locked prefix - must have space after sigil
  if (rest.startsWith(" ")) {
    return { isDirective: false, content: rest.trim() };
  }
  // Not a valid $locked (e.g., $lockedOut would not match)
  return null;
}

interface StreamDirectiveResult {
  mode: "lines" | "full";
  delimiter?: string[];
}

/**
 * Parse a $stream directive.
 * Returns null if not a stream directive, or the stream mode and optional delimiter.
 *
 * Modes:
 * - default (no keyword): new message per delimiter, sent when complete (no editing)
 * - "full": message(s) edited progressively as content streams
 *   - Without delimiter: single message for entire response
 *   - With delimiter: new message per delimiter, each edited progressively
 *
 * Syntax:
 * - $stream → new message per newline, sent complete
 * - $stream "delim" → new message per delimiter, sent complete
 * - $stream "a" "b" "c" → new message per any of these delimiters, sent complete
 * - $stream full → single message, edited progressively
 * - $stream full "delim" → new message per delimiter, each edited progressively
 * - $stream full "a" "b" → new message per any delimiter, each edited progressively
 */
function parseStreamDirective(content: string): StreamDirectiveResult | null {
  if (!content.startsWith(STREAM_SIGIL)) {
    return null;
  }
  let rest = content.slice(STREAM_SIGIL.length).trim();

  // Extract all quoted delimiters
  let delimiter: string[] | undefined;
  const quoteMatches = [...rest.matchAll(/["']([^"']+)["']/g)];
  if (quoteMatches.length > 0) {
    delimiter = quoteMatches.map(m => m[1]);
    rest = rest.replace(/["']([^"']+)["']/g, "").trim().toLowerCase();
  } else {
    rest = rest.toLowerCase();
  }

  // Parse mode
  let mode: "lines" | "full" = "lines";
  if (rest === "") {
    mode = "lines";
  } else if (rest === "full") {
    mode = "full";
  } else {
    // Unknown mode
    return null;
  }

  return { mode, delimiter };
}

/**
 * Parse a $model directive.
 * Returns null if not a model directive, or the model spec string.
 * Validates provider:model format.
 */
function parseModelDirective(content: string): string | null {
  if (!content.startsWith(MODEL_SIGIL)) {
    return null;
  }
  const spec = content.slice(MODEL_SIGIL.length).trim();
  if (!spec || !/^[^:]+:.+$/.test(spec)) {
    return null;
  }
  return spec;
}

/**
 * Parse a $strip directive.
 * Returns null if not a strip directive, or the array of patterns to strip.
 *
 * Syntax:
 * - $strip → explicit no-strip (empty array, disables default stripping)
 * - $strip "</blockquote>" → strip this pattern
 * - $strip "a" "b" "c" → strip any of these patterns
 *
 * Supports escape sequences: \n, \t, \\
 */
function parseStripDirective(content: string): string[] | null {
  if (!content.startsWith(STRIP_SIGIL)) {
    return null;
  }
  const rest = content.slice(STRIP_SIGIL.length);
  // Must be bare $strip or $strip followed by space
  if (rest !== "" && !rest.startsWith(" ")) {
    return null;
  }
  const trimmed = rest.trim();

  // Bare $strip → explicit empty (disable stripping)
  if (trimmed === "") {
    return [];
  }

  // Extract all quoted patterns
  const patterns: string[] = [];
  const quoteMatches = [...trimmed.matchAll(/["']([^"']+)["']/g)];
  if (quoteMatches.length === 0) {
    return null; // Has content but no quoted strings → invalid
  }
  for (const m of quoteMatches) {
    // Unescape sequences
    const unescaped = m[1]
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\");
    patterns.push(unescaped);
  }
  return patterns;
}

const VALID_THINKING_LEVELS = new Set<ThinkingLevel>(["minimal", "low", "medium", "high"]);

/**
 * Parse a $thinking directive.
 * Returns null if not a thinking directive, or the thinking level.
 *
 * Syntax:
 * - $thinking → defaults to "high"
 * - $thinking minimal → minimal thinking
 * - $thinking low → low thinking
 * - $thinking medium → medium thinking
 * - $thinking high → high thinking
 */
function parseThinkingDirective(content: string): ThinkingLevel | null {
  if (!content.startsWith(THINKING_SIGIL)) {
    return null;
  }
  const rest = content.slice(THINKING_SIGIL.length);
  // Must be bare $thinking or $thinking followed by space
  if (rest !== "" && !rest.startsWith(" ")) {
    return null;
  }
  const trimmed = rest.trim().toLowerCase();

  // Bare $thinking → high
  if (trimmed === "") {
    return "high";
  }

  if (VALID_THINKING_LEVELS.has(trimmed as ThinkingLevel)) {
    return trimmed as ThinkingLevel;
  }

  // Unknown level — not a valid $thinking directive
  return null;
}

const ALL_COLLAPSE_ROLES: CollapseRoles = new Set(["user", "assistant", "system"]);
const VALID_COLLAPSE_ROLE_NAMES = new Set(["user", "assistant", "system"]);

/**
 * Parse a space-separated list of role names into a CollapseRoles set.
 * Returns null if any token is unrecognized.
 *
 * Accepts: "all", "none", or space-separated subset of "user", "assistant", "system".
 */
export function parseCollapseRoles(str: string): CollapseRoles | null {
  const trimmed = str.trim().toLowerCase();
  if (trimmed === "" || trimmed === "all") return new Set(ALL_COLLAPSE_ROLES);
  if (trimmed === "none") return new Set();
  const parts = trimmed.split(/\s+/);
  const roles = new Set<"user" | "assistant" | "system">();
  for (const part of parts) {
    if (!VALID_COLLAPSE_ROLE_NAMES.has(part)) return null;
    roles.add(part as "user" | "assistant" | "system");
  }
  return roles;
}

/**
 * Parse a $collapse directive.
 * Returns null if not a collapse directive or has invalid content.
 *
 * Syntax:
 * - $collapse → collapse all roles (default behavior, explicit)
 * - $collapse all → same as bare $collapse
 * - $collapse none → disable collapsing entirely
 * - $collapse user → collapse only adjacent user messages
 * - $collapse assistant → collapse only adjacent assistant messages
 * - $collapse user assistant → collapse user and assistant (space-separated)
 * - $collapse system user assistant → all three roles (same as all)
 */
function parseCollapseDirective(content: string): CollapseRoles | null {
  if (!content.startsWith(COLLAPSE_SIGIL)) {
    return null;
  }
  const rest = content.slice(COLLAPSE_SIGIL.length);
  // Must be bare $collapse or $collapse followed by space
  if (rest !== "" && !rest.startsWith(" ")) {
    return null;
  }
  return parseCollapseRoles(rest);
}

/**
 * Parse a $safety directive.
 * Returns { category, expr } if valid, or null if not a safety directive.
 *
 * $safety syntax:
 * - $safety off → all categories OFF
 * - $safety sexual off → only sexually-explicit OFF
 * - $safety hate medium → hate speech at medium threshold
 * - $safety channel.is_nsfw → non-keyword expression → no override
 * - $safety sexual channel.is_nsfw → sexual only, non-keyword → no override
 *
 * Category keywords: sexual, hate, harassment, dangerous, civic
 * Threshold keywords (in expr): off, none, low, medium, high
 */
export function parseSafetyDirective(content: string): { category: SafetyCategory | "all"; expr: string } | null {
  if (!content.startsWith(SAFETY_SIGIL)) {
    return null;
  }
  const rest = content.slice(SAFETY_SIGIL.length);
  if (rest !== "" && !rest.startsWith(" ")) return null;
  const trimmed = rest.trim();

  // Check if first token is a known category keyword
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx !== -1) {
    const firstToken = trimmed.slice(0, spaceIdx).toLowerCase();
    if (SAFETY_CATEGORY_SET.has(firstToken)) {
      const expr = trimmed.slice(spaceIdx + 1).trim();
      return { category: firstToken as SafetyCategory, expr: expr === "" ? "true" : expr };
    }
  }

  // No category keyword: applies to all categories
  return { category: "all", expr: trimmed === "" ? "true" : trimmed };
}

/**
 * Map a threshold keyword string to a SafetyThreshold.
 * Returns null for unrecognized values.
 */
function evaluateSafetyThreshold(val: unknown): SafetyThreshold | null {
  if (typeof val === "string") {
    const lower = val.toLowerCase();
    if (lower === "off") return "off";
    if (lower === "none") return "none";
    if (lower === "low") return "low";
    if (lower === "medium") return "medium";
    if (lower === "high") return "high";
  }
  return null;
}

/**
 * Parse a $memory directive.
 * Returns null if not a memory directive, or the scope.
 *
 * Syntax:
 * - $memory → defaults to "none" (no retrieval)
 * - $memory none → no memory retrieval (default)
 * - $memory channel → retrieve memories from current channel
 * - $memory guild → retrieve memories from all channels in server
 * - $memory global → retrieve all memories
 */
function parseMemoryDirective(content: string): MemoryScope | null {
  if (!content.startsWith(MEMORY_SIGIL)) {
    return null;
  }
  const rest = content.slice(MEMORY_SIGIL.length).trim().toLowerCase();

  if (rest === "" || rest === "none") {
    return "none";
  }
  if (rest === "channel") {
    return "channel";
  }
  if (rest === "guild") {
    return "guild";
  }
  if (rest === "global") {
    return "global";
  }

  // Unknown scope - not a valid $memory directive
  return null;
}


/**
 * Parse a $context directive.
 * Returns null if not a context directive, or the context expression string.
 *
 * Syntax:
 * - $context 8000 → "chars < 8000" (backwards compat)
 * - $context 8k → "chars < 8000" (backwards compat)
 * - $context chars < 16000 → "chars < 16000"
 * - $context (chars < 4000 || count < 20) && age_h < 12 → expression
 */
function parseContextDirective(content: string): string | null {
  if (!content.startsWith(CONTEXT_SIGIL)) {
    return null;
  }
  const rest = content.slice(CONTEXT_SIGIL.length).trim();

  if (rest === "") {
    return null; // Need a value
  }

  // Backwards compat: parse number with optional 'k' suffix → convert to "chars < N"
  const numMatch = rest.toLowerCase().match(/^(\d+(?:\.\d+)?)(k)?$/);
  if (numMatch) {
    let value = parseFloat(numMatch[1]);
    if (numMatch[2] === "k") {
      value *= 1000;
    }
    const limit = Math.min(Math.floor(value), MAX_CONTEXT_CHAR_LIMIT);
    return `chars < ${limit}`;
  }

  // Otherwise treat as expression
  return rest;
}

// =============================================================================
// Context Expression Compiler
// =============================================================================

/** Variables available in $context expressions */
export interface ContextExprVars {
  /** Cumulative characters including current message */
  chars: number;
  /** Number of messages accumulated so far (0-indexed) */
  count: number;
  /** Current message age in milliseconds */
  age: number;
  /** Current message age in hours */
  age_h: number;
  /** Current message age in minutes */
  age_m: number;
  /** Current message age in seconds */
  age_s: number;
}

const CONTEXT_EXPR_PARAMS = ["chars", "count", "age", "age_h", "age_m", "age_s"] as const;
const CONTEXT_ALLOWED_IDENTS = new Set<string>([...CONTEXT_EXPR_PARAMS, "true", "false", "Infinity", "NaN"]);

/**
 * Compile a $context expression into a reusable predicate.
 * Returns a function that evaluates the expression with the given variables.
 * The expression should return truthy to include the message.
 */
export function compileContextExpr(expr: string): (vars: ContextExprVars) => boolean {
  // Validate identifiers: only allow context-specific variables
  const identPattern = /[a-zA-Z_][a-zA-Z0-9_]*/g;
  let m;
  while ((m = identPattern.exec(expr)) !== null) {
    if (!CONTEXT_ALLOWED_IDENTS.has(m[0])) {
      throw new Error(`Unknown identifier in $context expression: "${m[0]}". Allowed: ${CONTEXT_EXPR_PARAMS.join(", ")}`);
    }
  }

  try {
    const fn = new Function(...CONTEXT_EXPR_PARAMS, `"use strict"; return !!(${expr})`);
    return (vars) => fn(vars.chars, vars.count, vars.age, vars.age_h, vars.age_m, vars.age_s) as boolean;
  } catch (e) {
    throw new Error(`Invalid $context expression: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export interface EvaluatedFacts {
  /** Facts that apply (excluding directives) */
  facts: string[];
  /** Whether to respond. null means no $respond directives were present (default true). */
  shouldRespond: boolean | null;
  /** The fact/directive that set shouldRespond (for debugging) */
  respondSource: string | null;
  /** If set, re-evaluate after this many milliseconds. Last fired $retry wins. */
  retryMs: number | null;
  /** Avatar URL if $avatar directive was present */
  avatarUrl: string | null;
  /** True if $locked directive present (entity is locked from LLM modification) */
  isLocked: boolean;
  /** Set of fact content strings that are locked (from $locked prefix) */
  lockedFacts: Set<string>;
  /** Stream mode if $stream directive present */
  streamMode: "lines" | "full" | null;
  /** Custom delimiters for streaming (default: newline) */
  streamDelimiter: string[] | null;
  /** Memory retrieval scope (default: "none" = no retrieval) */
  memoryScope: MemoryScope;
  /** Context expression if $context directive present (e.g. "chars < 16000") */
  contextExpr: string | null;
  /** True if $freeform directive present (multi-char responses not split) */
  isFreeform: boolean;
  /** Model spec from $model directive (e.g. "google:gemini-2.0-flash"), last wins */
  modelSpec: string | null;
  /** Strip patterns from $strip directive. null = no directive (use default), [] = explicit no-strip */
  stripPatterns: string[] | null;
  /** Thinking level from $thinking directive. null = no directive (use default minimal for Google) */
  thinkingLevel: ThinkingLevel | null;
  /** Which roles to collapse adjacent messages for. null = no directive (default: all roles) */
  collapseMessages: CollapseRoles | null;
  /** Per-category content filter overrides from $safety directives. Empty = use provider defaults */
  contentFilters: ContentFilter[];
}

/**
 * Evaluate a list of facts, returning only those that apply.
 * Non-conditional facts always apply.
 * Conditional facts apply if their expression evaluates to true.
 *
 * Directives (evaluated top to bottom):
 * - $respond / $respond false → control response behavior (last one wins)
 * - $retry <ms> → schedule re-evaluation (early exit)
 * - $locked → lock entity from LLM modification
 * - $locked <fact> → lock specific fact from LLM modification
 */
/** Defaults from entity config columns (optional, seeded before fact evaluation) */
export interface EvaluatedFactsDefaults {
  contextExpr?: string | null;
  modelSpec?: string | null;
  avatarUrl?: string | null;
  streamMode?: "lines" | "full" | null;
  streamDelimiter?: string[] | null;
  memoryScope?: MemoryScope;
  isFreeform?: boolean;
  stripPatterns?: string[] | null;
  shouldRespond?: boolean | null;
  thinkingLevel?: ThinkingLevel | null;
  collapseMessages?: CollapseRoles | null;
}

/**
 * Extract the tick interval from a list of raw fact strings.
 * Returns the interval in ms, or null if no $tick directive is present.
 * First $tick wins (unconditional directives only).
 */
export function getTickInterval(facts: string[]): number | null {
  for (const fact of facts) {
    const trimmed = fact.trim();
    const result = parseTickDirective(trimmed);
    if (result !== null) return result;
  }
  return null;
}

export function evaluateFacts(
  facts: string[],
  context: ExprContext,
  defaults?: EvaluatedFactsDefaults,
): EvaluatedFacts {
  const results: string[] = [];
  let shouldRespond: boolean | null = defaults?.shouldRespond ?? null;
  let respondSource: string | null = null;
  let retryMs: number | null = null;
  let avatarUrl: string | null = defaults?.avatarUrl ?? null;
  let isLocked = false;
  const lockedFacts = new Set<string>();
  let streamMode: "lines" | "full" | null = defaults?.streamMode ?? null;
  let streamDelimiter: string[] | null = defaults?.streamDelimiter ?? null;
  let memoryScope: MemoryScope = defaults?.memoryScope ?? "none";
  let contextExpr: string | null = defaults?.contextExpr ?? null;
  let isFreeform = defaults?.isFreeform ?? false;
  let modelSpec: string | null = defaults?.modelSpec ?? null;
  let stripPatterns: string[] | null = defaults?.stripPatterns ?? null;
  let thinkingLevel: ThinkingLevel | null = defaults?.thinkingLevel ?? null;
  let collapseMessages: CollapseRoles | null = defaults?.collapseMessages ?? null;
  const safetyMap = new Map<SafetyCategory, SafetyThreshold>();

  // Strip comments first
  const uncommented = stripComments(facts);

  for (const fact of uncommented) {
    const parsed = parseFact(fact);

    // Check if this fact applies
    let applies = true;
    if (parsed.conditional && parsed.expression) {
      applies = evalExpr(parsed.expression, context);
    }

    if (!applies) continue;

    // Handle $locked directive - locks entire entity
    if (parsed.isLockedDirective) {
      isLocked = true;
      continue;
    }

    // Handle $locked prefix - fact is locked but visible
    if (parsed.isLockedFact) {
      lockedFacts.add(parsed.content);
      results.push(parsed.content);
      continue;
    }

    // Handle $respond directives - last one wins
    if (parsed.isRespond) {
      shouldRespond = parsed.respondValue ?? true;
      respondSource = fact;
      continue;
    }

    // Handle $retry directives - early exit
    if (parsed.isRetry) {
      retryMs = parsed.retryMs ?? null;
      break;
    }

    // Handle $avatar directives - last one wins
    if (parsed.isAvatar) {
      avatarUrl = parsed.avatarUrl ?? null;
      continue;
    }

    // Handle $stream directives - last one wins
    if (parsed.isStream) {
      streamMode = parsed.streamMode ?? null;
      streamDelimiter = parsed.streamDelimiter ?? null;
      continue;
    }

    // Handle $memory directives - last one wins
    if (parsed.isMemory) {
      memoryScope = parsed.memoryScope ?? "none";
      continue;
    }

    // Handle $context directives - last one wins
    if (parsed.isContext) {
      contextExpr = parsed.contextExpr ?? null;
      continue;
    }

    // Handle $freeform directive
    if (parsed.isFreeform) {
      isFreeform = true;
      continue;
    }

    // Handle $model directives - last one wins, strip from LLM context
    if (parsed.isModel) {
      modelSpec = parsed.modelSpec ?? null;
      continue;
    }

    // Handle $strip directives - last one wins, strip from LLM context
    if (parsed.isStrip) {
      stripPatterns = parsed.stripPatterns ?? [];
      continue;
    }

    // Handle $thinking directives - last one wins, strip from LLM context
    if (parsed.isThinking) {
      thinkingLevel = parsed.thinkingLevel ?? null;
      continue;
    }

    // Handle $collapse directives - last one wins, strip from LLM context
    if (parsed.isCollapse) {
      collapseMessages = parsed.collapseRoles ?? new Set(ALL_COLLAPSE_ROLES);
      continue;
    }

    // Handle $safety directives - accumulate per-category, last one wins per category
    if (parsed.isSafety) {
      const category = parsed.safetyCategory ?? "all";
      const expr = parsed.safetyExpr ?? "true";
      // Threshold keywords are not valid expr identifiers — handle as literals.
      // $safety only supports threshold keywords; non-keyword expressions yield no override.
      let threshold: SafetyThreshold | null;
      if (SAFETY_THRESHOLD_KEYWORDS.has(expr)) {
        threshold = evaluateSafetyThreshold(expr);
      } else {
        // Non-keyword expressions not supported in $safety — no override
        threshold = null;
      }
      if (threshold !== null) {
        const cats = category === "all" ? ALL_SAFETY_CATEGORIES : [category];
        for (const cat of cats) safetyMap.set(cat, threshold);
      } else {
        // false/null means "remove override" for this category
        const cats = category === "all" ? ALL_SAFETY_CATEGORIES : [category];
        for (const cat of cats) safetyMap.delete(cat);
      }
      continue;
    }

    results.push(parsed.content);
  }

  const contentFilters: ContentFilter[] = Array.from(safetyMap.entries())
    .map(([category, threshold]) => ({ category, threshold }));
  return { facts: results, shouldRespond, respondSource, retryMs, avatarUrl, isLocked, lockedFacts, streamMode, streamDelimiter, memoryScope, contextExpr, isFreeform, modelSpec, stripPatterns, thinkingLevel, collapseMessages, contentFilters };
}

// =============================================================================
// Permission Directives
// =============================================================================

export interface EntityPermissions {
  /** True if $locked directive present (entity is locked from LLM modification) */
  isLocked: boolean;
  /** Set of fact content strings that are locked (from $locked prefix) */
  lockedFacts: Set<string>;
  /** User IDs allowed to edit, "@everyone" for public, null for owner-only */
  editList: string[] | "@everyone" | null;
  /** User IDs allowed to view, "@everyone" for public, null for owner-only */
  viewList: string[] | "@everyone" | null;
  /** Users/IDs/roles allowed to trigger responses, "@everyone" for public, null for no restriction */
  useList: string[] | "@everyone" | null;
  /** Users/IDs blocked from all interactions (usernames or Discord IDs) */
  blacklist: string[];
}

/** Defaults from entity config columns for permission directives */
export interface PermissionDefaults {
  editList?: string[] | "@everyone" | null;
  viewList?: string[] | "@everyone" | null;
  useList?: string[] | "@everyone" | null;
  blacklist?: string[];
}

/**
 * Parse permission directives from raw facts.
 * Extracts $locked from facts; permission lists ($edit, $view, $use, $blacklist)
 * come from entity config columns via the defaults parameter.
 */
export function parsePermissionDirectives(facts: string[], defaults?: PermissionDefaults): EntityPermissions {
  let isLocked = false;
  const lockedFacts = new Set<string>();

  for (const fact of facts) {
    const trimmed = fact.trim();
    if (trimmed.startsWith("$#")) continue;

    if (trimmed === LOCKED_SIGIL) {
      isLocked = true;
      continue;
    }
    if (trimmed.startsWith(LOCKED_SIGIL + " ")) {
      lockedFacts.add(trimmed.slice(LOCKED_SIGIL.length + 1).trim());
      continue;
    }
  }

  return {
    isLocked,
    lockedFacts,
    editList: defaults?.editList ?? null,
    viewList: defaults?.viewList ?? null,
    useList: defaults?.useList ?? null,
    blacklist: [...(defaults?.blacklist ?? [])],
  };
}

/**
 * Check if a permission entry matches a user.
 * Entries can be Discord IDs (17-19 digits, matching user ID or role IDs) or usernames (case-insensitive).
 */
export function matchesUserEntry(entry: string, userId: string, username: string, userRoles: string[] = []): boolean {
  // Explicit role: prefix from mentionable select UI
  if (entry.startsWith("role:")) {
    return userRoles.includes(entry.slice(5));
  }
  // Discord IDs are 17-19 digit snowflakes - check user ID and role IDs
  if (/^\d{17,19}$/.test(entry)) {
    return entry === userId || userRoles.includes(entry);
  }
  // Usernames are case-insensitive
  return entry.toLowerCase() === username.toLowerCase();
}

/**
 * Check if a user is blacklisted from an entity.
 * Owner is NEVER blacklisted.
 */
export function isUserBlacklisted(
  permissions: EntityPermissions,
  userId: string,
  username: string,
  ownerId: string | null,
  userRoles: string[] = []
): boolean {
  // Owner is never blocked
  if (ownerId && userId === ownerId) return false;

  return permissions.blacklist.some(entry => matchesUserEntry(entry, userId, username, userRoles));
}

/**
 * Check if a user is allowed to trigger entity responses ($use whitelist).
 * Owner is always allowed.
 * null useList = no restriction (everyone allowed, default).
 * "@everyone" = explicitly everyone allowed.
 * Otherwise check the list entries.
 */
export function isUserAllowed(
  permissions: EntityPermissions,
  userId: string,
  username: string,
  ownerId: string | null,
  userRoles: string[] = []
): boolean {
  // Owner always allowed
  if (ownerId && userId === ownerId) return true;

  // No $use directive = no restriction
  if (permissions.useList === null) return true;

  // Explicit everyone
  if (permissions.useList === "@everyone") return true;

  // Check list entries
  return permissions.useList.some(entry => matchesUserEntry(entry, userId, username, userRoles));
}

// =============================================================================
// Re-exports (backward compatibility — importers use "expr" as the public API)
// =============================================================================

export { ExprError, compileExpr, evalExpr, compileTemplateExpr, evalMacroValue, evalRaw } from "./expr-compiler";
export { parseSelfContext, createBaseContext, checkKeywordMatch, checkMentionedInDialogue, rollDice, formatDuration, parseOffset, type BaseContextOptions } from "./expr-context";
