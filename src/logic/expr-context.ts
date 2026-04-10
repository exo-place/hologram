/**
 * Context factory and utility functions for expression evaluation.
 *
 * Provides createBaseContext(), parseSelfContext(), rollDice(),
 * formatDuration(), parseOffset(), and checkKeywordMatch().
 */

import { ExprError } from "./expr-compiler";
import { validateRegexPattern } from "./safe-regex";
import type { ExprContext, SelfContext, SafeDate } from "./expr";

// =============================================================================
// Self Context Parsing
// =============================================================================

/** Pattern for "key: value" facts */
const KEY_VALUE_PATTERN = /^([a-z_][a-z0-9_]*)\s*:\s*(.+)$/i;

/**
 * Parse a value string into typed value (number, boolean, or string).
 */
function parseValue(value: string): string | number | boolean {
  const trimmed = value.trim();

  // Boolean
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  // Number (including decimals)
  const num = parseFloat(trimmed);
  if (!isNaN(num) && String(num) === trimmed) return num;

  // String (default)
  return trimmed;
}

/**
 * Parse facts into a self context object.
 * Facts matching "key: value" pattern are extracted.
 * Other facts are ignored.
 *
 * Uses Object.create(null) so there's no prototype chain -
 * no constructor, __proto__, etc. to worry about.
 */
export function parseSelfContext(facts: string[]): SelfContext {
  const self: SelfContext = Object.create(null);

  for (const fact of facts) {
    // Skip comments
    if (fact.startsWith("$#")) continue;

    // Skip $if directives (we want raw facts)
    if (fact.trim().startsWith("$if ")) continue;

    const match = fact.match(KEY_VALUE_PATTERN);
    if (match) {
      const [, key, value] = match;
      self[key] = parseValue(value);
    }
  }

  return self;
}

// =============================================================================
// Context Factory
// =============================================================================

export interface BaseContextOptions {
  /** Entity's raw facts (used to build self context) */
  facts: string[];
  /** Function to check if entity has a fact matching pattern */
  has_fact: (pattern: string) => boolean;
  /** Function to get the last N messages from the channel. Format: %a=author, %m=message. Filter: "user", "char", or name. */
  messages: (n?: number, format?: string, filter?: string) => string;
  response_ms: number;
  retry_ms: number;
  idle_ms: number;
  unread_count: number;
  mentioned: boolean;
  replied: boolean;
  /** Name of entity that was replied to (for webhook replies) */
  replied_to: string;
  is_forward: boolean;
  /** Whether the message is from this entity's own webhook */
  is_self: boolean;
  /** Whether the message is from any hologram entity (our webhook) */
  is_hologram: boolean;
  /** Whether the message was sent with @silent (suppress notifications flag) */
  silent: boolean;
  interaction_type: string;
  /** This entity's name */
  name: string;
  /** Names of all characters bound to channel */
  chars: string[];
  /** Channel metadata */
  channel: { id: string; name: string; description: string; is_nsfw: boolean; type: string; mention: string };
  /** Server metadata */
  server: { id: string; name: string; description: string; nsfw_level: string };
  /** Trigger keywords to match against message content (plain strings or /regex/flags). Defaults to []. */
  keywords?: string[];
}

/**
 * Check if a name is mentioned in dialogue (quoted text).
 * If content has quotation marks OR multiple paragraphs, only checks within quotes.
 * Otherwise checks the full content (simple single-line messages).
 */
export function checkMentionedInDialogue(content: string, name: string): boolean {
  if (!name) return false;

  // Extract all quoted portions (both " and ')
  const quotePattern = /["']([^"']+)["']/g;
  const quotedParts: string[] = [];
  let match;
  while ((match = quotePattern.exec(content)) !== null) {
    quotedParts.push(match[1]);
  }

  // Check if content has multiple paragraphs (contains newlines)
  const hasMultipleParagraphs = content.includes("\n");
  const hasQuotes = quotedParts.length > 0;

  // If there are quotes OR multiple paragraphs, only check within quoted parts
  // (If there are multiple paragraphs but no quotes, nothing to check → return false)
  let textToCheck: string;
  if (hasQuotes || hasMultipleParagraphs) {
    if (!hasQuotes) return false; // Multiple paragraphs but no quotes
    textToCheck = quotedParts.join(" ");
  } else {
    textToCheck = content;
  }

  // Word boundary check for the name
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const namePattern = new RegExp(`\\b${escapedName}\\b`, "i");
  return namePattern.test(textToCheck);
}

/**
 * Match message content against a list of keyword patterns.
 * Plain strings use case-insensitive substring matching.
 * Patterns wrapped in /slashes/ are treated as safe regexes (validated against ReDoS).
 * Invalid regex patterns are silently skipped.
 */
export function checkKeywordMatch(keywords: string[], content: string): boolean {
  const lower = content.toLowerCase();
  for (const kw of keywords) {
    if (!kw) continue;
    const regexMatch = kw.match(/^\/(.+)\/([gimsuy]*)$/);
    if (regexMatch) {
      try {
        validateRegexPattern(regexMatch[1]);
        const regex = new RegExp(regexMatch[1], regexMatch[2] || "i");
        if (regex.test(content)) return true;
      } catch {
        // Invalid or unsafe regex — skip
      }
    } else {
      if (lower.includes(kw.toLowerCase())) return true;
    }
  }
  return false;
}

/**
 * Create a base context with standard globals.
 * Caller should extend with entity-specific data.
 */
export function createBaseContext(options: BaseContextOptions): ExprContext {
  const now = new Date();
  const hour = now.getHours();
  const { messages, chars } = options;
  const content = messages(1, "%m");
  const keywords = options.keywords ?? [];

  return {
    self: parseSelfContext(options.facts),
    random: (min?: number, max?: number) => {
      if (min === undefined) return Math.random();
      if (max === undefined) return Math.floor(Math.random() * min) + 1; // 1 to min
      return Math.floor(min + Math.random() * (max - min + 1)); // min to max inclusive
    },
    has_fact: options.has_fact,
    roll: (dice: string) => rollDice(dice),
    time: Object.assign(Object.create(null), {
      hour,
      is_day: hour >= 6 && hour < 18,
      is_night: hour < 6 || hour >= 18,
    }),
    response_ms: options.response_ms,
    retry_ms: options.retry_ms,
    idle_ms: options.idle_ms,
    unread_count: options.unread_count,
    mentioned: options.mentioned,
    replied: options.replied,
    replied_to: options.replied_to,
    is_forward: options.is_forward,
    is_self: options.is_self,
    is_hologram: options.is_hologram,
    silent: options.silent,
    mentioned_in_dialogue: (name: string) => checkMentionedInDialogue(content, name),
    content,
    author: messages(1, "%a"),
    keyword_match: checkKeywordMatch(keywords, content),
    interaction_type: options.interaction_type,
    name: options.name,
    chars,
    messages,
    group: chars.join(", "),
    duration: (ms: number) => formatDuration(ms),
    date_str: (offset?: string) => {
      const d = offset ? applyOffset(now, offset) : now;
      return d.toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
    },
    time_str: (offset?: string) => {
      const d = offset ? applyOffset(now, offset) : now;
      return d.toLocaleTimeString("en-US");
    },
    isodate: (offset?: string) => {
      const d = offset ? applyOffset(now, offset) : now;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    },
    isotime: (offset?: string) => {
      const d = offset ? applyOffset(now, offset) : now;
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    },
    weekday: (offset?: string) => {
      const d = offset ? applyOffset(now, offset) : now;
      return d.toLocaleDateString("en-US", { weekday: "long" });
    },
    pick: <T>(arr: T[]) => {
      if (!Array.isArray(arr) || arr.length === 0) return undefined;
      return arr[Math.floor(Math.random() * arr.length)];
    },
    channel: Object.assign(Object.create(null), options.channel),
    server: Object.assign(Object.create(null), options.server),
    // Safe Date wrapper with null prototype to prevent prototype chain escapes
    Date: Object.freeze(Object.assign(Object.create(null), {
      new: (...args: unknown[]) => {
        if (args.length === 0) return new globalThis.Date();
        if (args.length === 1) return new globalThis.Date(args[0] as string | number);
        // Component-based: Date(year, month, day?, hours?, minutes?, seconds?, ms?)
        const [year, month, ...rest] = args as number[];
        return new globalThis.Date(year, month, ...rest);
      },
      now: () => globalThis.Date.now(),
      parse: (dateString: string) => globalThis.Date.parse(String(dateString)),
      UTC: (year: number, monthIndex?: number, date?: number, hours?: number, minutes?: number, seconds?: number, ms?: number) => {
        // Date.UTC doesn't like undefined values, so only pass defined args
        const args: number[] = [year, monthIndex ?? 0];
        if (date !== undefined) args.push(date);
        if (hours !== undefined) args.push(hours);
        if (minutes !== undefined) args.push(minutes);
        if (seconds !== undefined) args.push(seconds);
        if (ms !== undefined) args.push(ms);
        // Use spread to avoid passing undefined values
        return (globalThis.Date.UTC as (...args: number[]) => number)(...args);
      },
    })) as SafeDate,
  };
}

/**
 * Roll20-style dice roller.
 *
 * Supported syntax:
 * - Basic: 2d6, 1d20+5, 3d8-2
 * - Keep highest/lowest: 4d6kh3, 4d6kl1
 * - Drop highest/lowest: 4d6dh1, 4d6dl1
 * - Exploding: 1d6! (reroll and add on max, cap at 100)
 * - Success counting: 8d6>=5 (count dice >= 5)
 */
export function rollDice(expr: string): number {
  const match = expr.match(
    /^(\d+)d(\d+)(kh\d+|kl\d+|dh\d+|dl\d+|!)?([+-]\d+)?(>=\d+|<=\d+|>\d+|<\d+)?$/
  );
  if (!match) {
    throw new ExprError(`Invalid dice expression: ${expr}`);
  }

  const count = parseInt(match[1]);
  const sides = parseInt(match[2]);
  const keepDrop = match[3] ?? "";
  const modifier = match[4] ? parseInt(match[4]) : 0;
  const successExpr = match[5] ?? "";

  // Roll dice
  const dice: number[] = [];
  const isExploding = keepDrop === "!";

  for (let i = 0; i < count; i++) {
    let roll = Math.floor(Math.random() * sides) + 1;
    if (isExploding) {
      let total = roll;
      let explosions = 0;
      while (roll === sides && explosions < 100) {
        roll = Math.floor(Math.random() * sides) + 1;
        total += roll;
        explosions++;
      }
      dice.push(total);
    } else {
      dice.push(roll);
    }
  }

  // Apply keep/drop modifiers
  let filtered = dice.slice();
  if (keepDrop && !isExploding) {
    const n = parseInt(keepDrop.slice(2));
    const sorted = dice.slice().sort((a, b) => a - b);
    if (keepDrop.startsWith("kh")) {
      filtered = sorted.slice(-n);
    } else if (keepDrop.startsWith("kl")) {
      filtered = sorted.slice(0, n);
    } else if (keepDrop.startsWith("dh")) {
      filtered = sorted.slice(0, sorted.length - n);
    } else if (keepDrop.startsWith("dl")) {
      filtered = sorted.slice(n);
    }
  }

  // Success counting
  if (successExpr) {
    const op = successExpr.match(/^(>=|<=|>|<)(\d+)$/)!;
    const threshold = parseInt(op[2]);
    let successes = 0;
    for (const d of filtered) {
      if (
        (op[1] === ">=" && d >= threshold) ||
        (op[1] === "<=" && d <= threshold) ||
        (op[1] === ">" && d > threshold) ||
        (op[1] === "<" && d < threshold)
      ) {
        successes++;
      }
    }
    return successes;
  }

  // Sum + modifier
  let total = modifier;
  for (const d of filtered) {
    total += d;
  }
  return total;
}

// =============================================================================
// Duration & Offset Utilities
// =============================================================================

/**
 * Format a duration in milliseconds as a human-readable string.
 * Picks up to 2 largest non-zero units from: weeks, days, hours, minutes, seconds.
 */
export function formatDuration(ms: number): string {
  if (ms === 0) return "just now";
  if (!isFinite(ms)) return "a long time";

  const absMs = Math.abs(ms);
  const units: [string, number][] = [
    ["week", Math.floor(absMs / 604800000)],
    ["day", Math.floor((absMs % 604800000) / 86400000)],
    ["hour", Math.floor((absMs % 86400000) / 3600000)],
    ["minute", Math.floor((absMs % 3600000) / 60000)],
    ["second", Math.floor((absMs % 60000) / 1000)],
  ];

  const parts: string[] = [];
  for (const [name, value] of units) {
    if (value > 0) {
      parts.push(`${value} ${name}${value !== 1 ? "s" : ""}`);
      if (parts.length === 2) break;
    }
  }

  return parts.length > 0 ? parts.join(" ") : "just now";
}

/** Unit multipliers in milliseconds */
const UNIT_MS: Record<string, number> = {
  w: 604800000, week: 604800000, weeks: 604800000,
  d: 86400000, day: 86400000, days: 86400000,
  h: 3600000, hour: 3600000, hours: 3600000,
  m: 60000, min: 60000, mins: 60000, minute: 60000, minutes: 60000,
  s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000,
};

/**
 * Parse an offset string into years, months, and milliseconds.
 * Supports: "3y2mo", "1d", "-1w", "3 years 2 months", "30s", "1h30m"
 */
export function parseOffset(offset: string): { years: number; months: number; ms: number } {
  const trimmed = offset.trim();
  const negative = trimmed.startsWith("-");
  const abs = negative ? trimmed.slice(1) : trimmed;

  let years = 0;
  let months = 0;
  let ms = 0;

  // Match number+unit pairs (e.g. "3y", "2 months", "30s")
  const pattern = /(\d+)\s*(y(?:ears?)?|mo(?:nths?)?|w(?:eeks?)?|d(?:ays?)?|h(?:ours?)?|m(?:in(?:utes?|s)?)?|s(?:ec(?:onds?|s)?)?)\s*/gi;
  let match;
  while ((match = pattern.exec(abs)) !== null) {
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    if (unit === "y" || unit === "year" || unit === "years") {
      years += value;
    } else if (unit === "mo" || unit === "month" || unit === "months") {
      months += value;
    } else {
      const mult = UNIT_MS[unit];
      if (mult) ms += value * mult;
    }
  }

  const sign = negative ? -1 : 1;
  return { years: years * sign, months: months * sign, ms: ms * sign };
}

/**
 * Apply an offset string to a date.
 */
function applyOffset(date: Date, offset: string): Date {
  const { years, months, ms } = parseOffset(offset);
  const result = new Date(date.getTime());
  if (years) result.setFullYear(result.getFullYear() + years);
  if (months) result.setMonth(result.getMonth() + months);
  if (ms) result.setTime(result.getTime() + ms);
  return result;
}
