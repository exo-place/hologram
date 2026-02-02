import DEFAULT_TEMPLATE_SOURCE from "../templates/default.njk" with { type: "text" };

/**
 * Nunjucks-based template engine with runtime security patches.
 *
 * Supported syntax (full Nunjucks):
 *   {{ expr }}                           — expression output
 *   {% if expr %}...{% elif %}...{% else %}...{% endif %}
 *   {% for var in expr %}...{% else %}...{% endfor %}
 *   {% block name %}...{% endblock %}    — named blocks (inline)
 *   {{ value | filter }}                 — pipe filters
 *   {%- tag -%}                          — whitespace control
 *   {# comment #}
 *
 * Security: All property access goes through runtime.memberLookup,
 * all function calls through runtime.callWrap. We patch both to block
 * prototype chain traversal and dangerous methods.
 */

import { randomBytes } from "crypto";
import nunjucks from "nunjucks";
import { ExprError } from "../logic/expr";
import { validateRegexPattern } from "../logic/safe-regex";
import { getEntityByName, getEntityTemplate } from "../db/entities";

// =============================================================================
// Limits
// =============================================================================

/** Maximum output length in bytes */
const MAX_OUTPUT_LENGTH = 1_000_000;

/** Maximum iterations per for-loop (via fromIterator cap) */
const MAX_LOOP_ITERATIONS = 1000;

/** Max characters a string-producing method can output */
const MAX_STRING_OUTPUT = 100_000;

// =============================================================================
// Security Patches (applied once at module load)
// =============================================================================

/** Properties blocked on all objects (prevent prototype chain escapes) */
const BLOCKED_PROPS = new Set([
  "constructor",
  "__proto__",
  "prototype",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);

/** Symbol used to thread the method receiver from memberLookup to callWrap */
const RECEIVER_SYM = Symbol("hologram.receiver");

// Patch memberLookup: block dangerous property access, tag receivers for wrapped methods
const origMemberLookup = nunjucks.runtime.memberLookup;
nunjucks.runtime.memberLookup = function (
  obj: unknown,
  val: unknown,
): unknown {
  if (typeof val === "string" && BLOCKED_PROPS.has(val)) {
    return undefined; // Silent block — matches expr.ts behavior
  }
  const result = origMemberLookup.call(this, obj, val);
  // Tag wrapped method wrappers with their receiver so callWrap can
  // compute exact output sizes before allocating (e.g. str.length * count)
  if (typeof result === "function" && typeof val === "string" && WRAPPED_METHODS.has(val)) {
    (result as unknown as Record<symbol, unknown>)[RECEIVER_SYM] = obj;
  }
  return result;
};

/** Methods blocked entirely */
const BLOCKED_METHODS: Record<string, string> = {
  matchAll: "matchAll() is not available — use match() instead",
};

/** Methods that compile their first string argument into a RegExp */
const REGEX_METHODS = new Set(["match", "search", "replace", "split"]);

/** Methods rewritten to use safe wrappers (memory exhaustion prevention) */
const WRAPPED_METHODS = new Set([
  "repeat",
  "padStart",
  "padEnd",
  "replaceAll",
  "join",
]);

// Patch callWrap: block dangerous methods, validate regex, wrap memory-dangerous methods
const origCallWrap = nunjucks.runtime.callWrap;
nunjucks.runtime.callWrap = function (
  obj: unknown,
  name: string,
  context: unknown,
  args: unknown[],
): unknown {
  // Extract the method name from "obj.method" or 'obj["method"]' style names
  let methodName: string;
  const bracketMatch = name.match(/\["(\w+)"\]$/);
  if (bracketMatch) {
    methodName = bracketMatch[1];
  } else {
    const dotIdx = name.lastIndexOf(".");
    methodName = dotIdx >= 0 ? name.slice(dotIdx + 1) : name;
  }

  // Block dangerous methods
  if (methodName in BLOCKED_METHODS) {
    throw new ExprError(BLOCKED_METHODS[methodName]);
  }

  // Block .apply(), .bind(), .call()
  if (
    methodName === "apply" ||
    methodName === "bind" ||
    methodName === "call"
  ) {
    throw new ExprError(`${methodName}() is not allowed in templates`);
  }

  // Validate regex for methods that compile strings to RegExp
  if (REGEX_METHODS.has(methodName) && args.length > 0) {
    const pattern = args[0];
    if (typeof pattern === "string") {
      validateRegexPattern(pattern);
    }
  }

  // Wrap memory-dangerous methods — pre-validate using exact output size
  // where possible to reject before the JS engine allocates the string
  if (WRAPPED_METHODS.has(methodName)) {
    let receiver: unknown;
    if (typeof obj === "function") {
      const tagged = obj as unknown as Record<symbol, unknown>;
      receiver = tagged[RECEIVER_SYM];
      delete tagged[RECEIVER_SYM];
    }

    if (methodName === "repeat") {
      const count = typeof args[0] === "number" ? args[0] : 0;
      if (typeof receiver === "string") {
        // Exact: output is receiver.length * count
        const outputLen = receiver.length * count;
        if (outputLen > MAX_STRING_OUTPUT) {
          throw new ExprError(
            `repeat() would produce ${outputLen.toLocaleString()} characters (limit: ${MAX_STRING_OUTPUT.toLocaleString()})`,
          );
        }
      } else if (count > MAX_STRING_OUTPUT) {
        // Fallback: no receiver info, at least block absurd counts
        throw new ExprError(
          `repeat() count ${count.toLocaleString()} exceeds limit (${MAX_STRING_OUTPUT.toLocaleString()})`,
        );
      }
    } else if (methodName === "padStart" || methodName === "padEnd") {
      // Exact: output is max(receiver.length, targetLength)
      const targetLength = args[0];
      if (typeof targetLength === "number" && targetLength > MAX_STRING_OUTPUT) {
        throw new ExprError(
          `${methodName}() target length ${targetLength.toLocaleString()} exceeds limit (${MAX_STRING_OUTPUT.toLocaleString()})`,
        );
      }
    }

    if (typeof obj === "function") {
      const result = origCallWrap.call(this, obj, name, context, args);
      if (typeof result === "string" && result.length > MAX_STRING_OUTPUT) {
        throw new ExprError(
          `${methodName}() produced ${result.length.toLocaleString()} characters (limit: ${MAX_STRING_OUTPUT.toLocaleString()})`,
        );
      }
      return result;
    }
  }

  return origCallWrap.call(this, obj, name, context, args);
};

// Patch fromIterator: cap loop iteration count
const origFromIterator = nunjucks.runtime.fromIterator;
nunjucks.runtime.fromIterator = function (arr: unknown): unknown {
  const result = origFromIterator(arr);
  if (Array.isArray(result) && result.length > MAX_LOOP_ITERATIONS) {
    throw new ExprError(
      `Loop exceeds ${MAX_LOOP_ITERATIONS} iteration limit (got ${result.length})`,
    );
  }
  return result;
};

// =============================================================================
// Template Loader (Entity-Name Resolution)
// =============================================================================

class EntityTemplateLoader extends nunjucks.Loader {
  cache: Record<string, unknown> = {};
  private internalTemplates = new Map<string, string>();
  /** Macro definition to prepend to loaded entity templates (set per render call) */
  private _macroDef: string | null = null;

  getSource(name: string): { src: string; path: string; noCache: boolean } | null {
    const internal = this.internalTemplates.get(name);
    if (internal !== undefined) {
      return { src: internal, path: `internal:${name}`, noCache: true };
    }
    const entity = getEntityByName(name);
    if (!entity) return null;
    const template = getEntityTemplate(entity.id);
    if (!template) return null;
    // Prepend send_as macro to entity templates that don't start with {% extends %}
    let src = template;
    if (this._macroDef && !startsWithExtends(template)) {
      src = this._macroDef + "\n" + template;
    }
    return { src, path: `entity:${entity.id}:${name}`, noCache: true };
  }

  setInternal(name: string, source: string) { this.internalTemplates.set(name, source); }
  clearInternal(name: string) { this.internalTemplates.delete(name); }
  setMacroDef(def: string | null) { this._macroDef = def; }
}

// =============================================================================
// Environment Setup
// =============================================================================

const loader = new EntityTemplateLoader();
const env = new nunjucks.Environment(loader, {
  autoescape: false, // No HTML escaping (we're generating LLM prompts)
  trimBlocks: true, // Strip newline after block tags
  lstripBlocks: true, // Strip leading whitespace on block-only lines
  throwOnUndefined: true, // Undefined variables throw errors
});

// =============================================================================
// Built-in Filters
// =============================================================================

env.addFilter("default", (val: unknown, def: unknown) =>
  val == null || val === "" ? def : val,
);

env.addFilter("length", (val: unknown) => {
  if (Array.isArray(val)) return val.length;
  if (typeof val === "string") return val.length;
  return 0;
});

env.addFilter("join", (arr: unknown, sep?: unknown, attr?: unknown) => {
  if (!Array.isArray(arr)) return "";
  const items = attr !== undefined ? arr.map(v => v != null ? v[String(attr)] : v) : arr;
  const result = sep !== undefined ? items.join(String(sep)) : items.join();
  if (result.length > MAX_STRING_OUTPUT) {
    throw new ExprError(
      `join() produced ${result.length.toLocaleString()} characters (limit: ${MAX_STRING_OUTPUT.toLocaleString()})`,
    );
  }
  return result;
});

env.addFilter("first", (val: unknown) => {
  if (Array.isArray(val)) return val[0];
  if (typeof val === "string") return val[0];
  return undefined;
});

env.addFilter("last", (val: unknown) => {
  if (Array.isArray(val)) return val[val.length - 1];
  if (typeof val === "string") return val[val.length - 1];
  return undefined;
});

env.addFilter("upper", (val: unknown) =>
  typeof val === "string" ? val.toUpperCase() : val,
);

env.addFilter("lower", (val: unknown) =>
  typeof val === "string" ? val.toLowerCase() : val,
);

env.addFilter("trim", (val: unknown) =>
  typeof val === "string" ? val.trim() : val,
);

env.addFilter("nl2br", (val: unknown) =>
  // Identity for LLM prompts — no HTML conversion needed
  val,
);

env.addFilter("int", (val: unknown) => {
  const n = parseInt(String(val));
  return isNaN(n) ? 0 : n;
});

env.addFilter("float", (val: unknown) => {
  const n = parseFloat(String(val));
  return isNaN(n) ? 0.0 : n;
});

env.addFilter("abs", (val: unknown) =>
  typeof val === "number" ? Math.abs(val) : val,
);

env.addFilter("round", (val: unknown, precision?: unknown) => {
  if (typeof val !== "number") return val;
  const p =
    typeof precision === "number" ? precision : 0;
  const factor = Math.pow(10, p);
  return Math.round(val * factor) / factor;
});

env.addFilter("reverse", (val: unknown) => {
  if (Array.isArray(val)) return val.slice().reverse();
  if (typeof val === "string") return val.split("").reverse().join("");
  return val;
});

env.addFilter("sort", (val: unknown) => {
  if (!Array.isArray(val)) return val;
  return val.slice().sort();
});

env.addFilter("batch", (val: unknown, n: unknown) => {
  if (!Array.isArray(val)) return val;
  const size = typeof n === "number" ? n : 1;
  const batches: unknown[][] = [];
  for (let i = 0; i < val.length; i += size) {
    batches.push(val.slice(i, i + size));
  }
  return batches;
});

// =============================================================================
// Public API
// =============================================================================

/**
 * Render a template string with the given context.
 * Throws ExprError on security violations or output limits.
 */
export function renderEntityTemplate(
  source: string,
  ctx: Record<string, unknown>,
): string {
  try {
    const result = env.renderString(source, ctx);
    if (result.length > MAX_OUTPUT_LENGTH) {
      throw new ExprError(
        `Template output exceeds ${MAX_OUTPUT_LENGTH.toLocaleString()} character limit`,
      );
    }
    return result;
  } catch (err) {
    if (err instanceof ExprError) throw err;
    // Wrap Nunjucks errors in ExprError for consistent error handling
    throw new ExprError(
      `Template error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// =============================================================================
// Nonce-Based Structured Output Protocol
// =============================================================================

/**
 * Marker format (plain-text roles):
 * - Open:  <<<HMSG:{nonce}:{role}>>>  (role is system|user|assistant)
 * - Close: <<<HMSG_END:{nonce}>>>
 */
const MARKER_OPEN_PREFIX = "<<<HMSG:";
const MARKER_CLOSE_PREFIX = "<<<HMSG_END:";
const MARKER_SUFFIX = ">>>";

/** Regex for role validation — only word characters allowed */
const VALID_ROLE = /^\w+$/;

export interface ParsedTemplateMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ParsedTemplateOutput {
  /** All messages including system-role segments */
  messages: ParsedTemplateMessage[];
}

/**
 * Parse structured output from a rendered template.
 * Collects open/close marker pairs to extract messages. Unmarked text between
 * (or outside) marker pairs becomes system-role messages. No markers at all =
 * entire output is a single system message (legacy compat).
 */
export function parseStructuredOutput(rendered: string, nonce: string): ParsedTemplateOutput {
  // Build patterns for open and close markers
  const openPattern = new RegExp(
    `${escapeRegExp(MARKER_OPEN_PREFIX)}${escapeRegExp(nonce)}:(\\w+)${escapeRegExp(MARKER_SUFFIX)}`,
    "g",
  );
  const closePattern = new RegExp(
    `${escapeRegExp(MARKER_CLOSE_PREFIX)}${escapeRegExp(nonce)}${escapeRegExp(MARKER_SUFFIX)}`,
    "g",
  );

  // Collect all markers with their positions
  interface Marker { index: number; length: number; type: "open" | "close"; role?: string }
  const allMarkers: Marker[] = [];

  let match: RegExpExecArray | null;
  while ((match = openPattern.exec(rendered)) !== null) {
    const role = match[1];
    if (VALID_ROLE.test(role)) {
      allMarkers.push({ index: match.index, length: match[0].length, type: "open", role });
    }
  }
  while ((match = closePattern.exec(rendered)) !== null) {
    allMarkers.push({ index: match.index, length: match[0].length, type: "close" });
  }

  // No markers → entire output is a single system message (legacy compat)
  if (allMarkers.length === 0) {
    const trimmed = rendered.trim();
    return { messages: trimmed ? [{ role: "system", content: trimmed }] : [] };
  }

  // Sort by position
  allMarkers.sort((a, b) => a.index - b.index);

  const messages: ParsedTemplateMessage[] = [];
  let cursor = 0;

  let i = 0;
  while (i < allMarkers.length) {
    const marker = allMarkers[i];

    // Unmarked text before this marker → system-role message
    const unmarked = rendered.slice(cursor, marker.index).trim();
    if (unmarked) {
      messages.push({ role: "system", content: unmarked });
    }

    if (marker.type === "close") {
      // Orphaned close marker — skip
      cursor = marker.index + marker.length;
      i++;
      continue;
    }

    // Open marker — find matching close
    const contentStart = marker.index + marker.length;
    const role = marker.role as "system" | "user" | "assistant";

    if (i + 1 < allMarkers.length && allMarkers[i + 1].type === "close") {
      // Matched pair
      const contentEnd = allMarkers[i + 1].index;
      const content = rendered.slice(contentStart, contentEnd).trim();
      if (content) {
        messages.push({ role, content });
      }
      cursor = allMarkers[i + 1].index + allMarkers[i + 1].length;
      i += 2;
    } else {
      // Orphaned open marker — take content until next marker or end
      const nextIdx = i + 1 < allMarkers.length ? allMarkers[i + 1].index : rendered.length;
      const content = rendered.slice(contentStart, nextIdx).trim();
      if (content) {
        messages.push({ role, content });
      }
      cursor = nextIdx;
      i++;
    }
  }

  // Trailing unmarked text → system-role message
  const trailing = rendered.slice(cursor).trim();
  if (trailing) {
    messages.push({ role: "system", content: trailing });
  }

  return { messages };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build the send_as macro definition string for a given nonce.
 * Produces: {% macro send_as(role) %}<<<HMSG:{nonce}:{{ role }}>>>{{ caller() }}<<<HMSG_END:{nonce}>>>{% endmacro %}
 */
function buildSendAsMacro(nonce: string): string {
  return `{% macro send_as(role) %}${MARKER_OPEN_PREFIX}${nonce}:{{ role }}${MARKER_SUFFIX}{{ caller() }}${MARKER_CLOSE_PREFIX}${nonce}${MARKER_SUFFIX}{% endmacro %}`;
}

/**
 * Check if a template source starts with {% extends %} (after comments and whitespace).
 * Required because {% extends %} must be the first tag in Nunjucks.
 */
function startsWithExtends(source: string): boolean {
  // Strip leading whitespace and {# comments #}
  const stripped = source.replace(/^\s*(\{#[\s\S]*?#\}\s*)*/g, "");
  return /^\{%[-\s]*extends\s/.test(stripped);
}

// =============================================================================
// Default Templates (Nunjucks)
// =============================================================================

/**
 * Template for the dedicated system parameter (AI SDK `system` field).
 * Rendered separately from the conversation messages template.
 *
 * This is distinct from system-role messages in the conversation — those carry
 * entity definitions, memories, and instructions. This top-level system field
 * provides framing context that the LLM sees before any messages.
 */
export const SYSTEM_PROMPT_TEMPLATE = "";

/**
 * Default template loaded from src/templates/default.njk.
 *
 * Uses send_as() macro for role designation. Unmarked text becomes
 * system-role messages automatically. History messages use
 * {% call send_as(role) %} for proper user/assistant roles.
 */
export const DEFAULT_TEMPLATE = DEFAULT_TEMPLATE_SOURCE;

/**
 * Render a template and parse structured output.
 * Injects a `send_as(role)` macro via `{% call send_as("user") %}...{% endcall %}`.
 * Unmarked text becomes system-role messages. No markers = single system message.
 */
export function renderStructuredTemplate(
  source: string,
  ctx: Record<string, unknown>,
): ParsedTemplateOutput {
  const nonce = randomBytes(32).toString("hex");
  const macroDef = buildSendAsMacro(nonce);

  // Augment user template: prepend macro if it doesn't start with {% extends %}
  let augmented: string;
  if (startsWithExtends(source)) {
    augmented = source;
  } else {
    augmented = macroDef + "\n" + source;
  }

  // Register augmented template as internal parent
  const parentName = `_render_${nonce}`;
  loader.setInternal(parentName, augmented);
  loader.setMacroDef(macroDef);

  try {
    // Render via empty child that extends the parent — this triggers the parent
    // render and works uniformly whether or not the source uses {% extends %}
    const rendered = renderEntityTemplate(`{% extends "${parentName}" %}`, ctx);
    return parseStructuredOutput(rendered, nonce);
  } finally {
    loader.clearInternal(parentName);
    loader.setMacroDef(null);
  }
}

/**
 * Render the dedicated system prompt template.
 * Returns the string for the AI SDK `system` parameter, separate from messages.
 */
export function renderSystemPrompt(
  ctx: Record<string, unknown>,
  template?: string,
): string {
  const source = template ?? SYSTEM_PROMPT_TEMPLATE;
  return renderEntityTemplate(source, ctx).trim();
}
