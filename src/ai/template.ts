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

import nunjucks from "nunjucks";
import { ExprError } from "../logic/expr";
import { validateRegexPattern } from "../logic/safe-regex";

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

// Patch memberLookup: block dangerous property access
const origMemberLookup = nunjucks.runtime.memberLookup;
nunjucks.runtime.memberLookup = function (
  obj: unknown,
  val: unknown,
): unknown {
  if (typeof val === "string" && BLOCKED_PROPS.has(val)) {
    return undefined; // Silent block — matches expr.ts behavior
  }
  return origMemberLookup.call(this, obj, val);
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

  // Wrap memory-dangerous methods
  if (WRAPPED_METHODS.has(methodName) && typeof obj === "function") {
    // obj here is the bound method — but we need to intercept the result
    const result = origCallWrap.call(this, obj, name, context, args);
    if (typeof result === "string" && result.length > MAX_STRING_OUTPUT) {
      throw new ExprError(
        `${methodName}() produced ${result.length.toLocaleString()} characters (limit: ${MAX_STRING_OUTPUT.toLocaleString()})`,
      );
    }
    return result;
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
// Environment Setup
// =============================================================================

const env = new nunjucks.Environment(null, {
  autoescape: false, // No HTML escaping (we're generating LLM prompts)
  trimBlocks: true, // Strip newline after block tags
  lstripBlocks: true, // Strip leading whitespace on block-only lines
  throwOnUndefined: false, // Undefined variables render as empty string
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

env.addFilter("join", (arr: unknown, sep?: unknown) => {
  if (!Array.isArray(arr)) return "";
  const result = sep !== undefined ? arr.join(String(sep)) : arr.join();
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
