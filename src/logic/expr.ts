/**
 * Restricted JavaScript expression evaluator for $if conditional facts.
 *
 * Expressions are boolean JS with safe globals:
 *   $if random(0.3): has fox ears
 *   $if hasFact("poisoned") && random(0.5): takes damage
 *   $if time.isNight: glows faintly
 */

// =============================================================================
// Types
// =============================================================================

export interface ExprContext {
  /** Returns true with given probability (0.0-1.0) */
  random: (chance: number) => boolean;
  /** Check if entity has a fact matching pattern */
  hasFact: (pattern: string) => boolean;
  /** Roll dice expression (e.g. "2d6+3"), returns total */
  roll: (dice: string) => number;
  /** Current time info */
  time: {
    hour: number;
    isDay: boolean;
    isNight: boolean;
  };
  /** Interaction type if applicable (drink, eat, throw, etc.) */
  interactionType?: string;
  /** Additional context-specific variables */
  [key: string]: unknown;
}

// =============================================================================
// Sanitization
// =============================================================================

// Allowed tokens in expressions
const ALLOWED_PATTERN = /^[\w\s\d.,()[\]!&|<>=+\-*/%?:"']+$/;

// Dangerous patterns to reject
const DANGEROUS_PATTERNS = [
  /\beval\b/,
  /\bFunction\b/,
  /\bconstructor\b/,
  /\bprototype\b/,
  /\b__proto__\b/,
  /\bimport\b/,
  /\bexport\b/,
  /\brequire\b/,
  /\bprocess\b/,
  /\bglobal\b/,
  /\bwindow\b/,
  /\bdocument\b/,
  /\bfetch\b/,
  /\bXMLHttpRequest\b/,
  /\bsetTimeout\b/,
  /\bsetInterval\b/,
  /\bPromise\b/,
  /\basync\b/,
  /\bawait\b/,
  /\bwhile\b/,
  /\bfor\b/,
  /\bdo\b/,
  /\bclass\b/,
  /\bnew\b/,
  /\bthis\b/,
  /\bsuper\b/,
  /\breturn\b/,
  /\bthrow\b/,
  /\btry\b/,
  /\bcatch\b/,
  /\bfinally\b/,
  /\bdelete\b/,
  /\btypeof\b/,
  /\binstanceof\b/,
  /\bvoid\b/,
  /\bin\b/,
  /\bof\b/,
  /\blet\b/,
  /\bconst\b/,
  /\bvar\b/,
  /\bfunction\b/,
  /=>/,        // arrow functions
  /[;{}]/,     // statement separators, blocks
];

export function sanitizeExpr(expr: string): string {
  const trimmed = expr.trim();

  if (!ALLOWED_PATTERN.test(trimmed)) {
    throw new ExprError(`Invalid characters in expression: ${trimmed}`);
  }

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new ExprError(`Dangerous pattern in expression: ${trimmed}`);
    }
  }

  return trimmed;
}

// =============================================================================
// Compilation & Caching
// =============================================================================

const exprCache = new Map<string, (ctx: ExprContext) => boolean>();

export function compileExpr(expr: string): (ctx: ExprContext) => boolean {
  let fn = exprCache.get(expr);
  if (fn) return fn;

  const sanitized = sanitizeExpr(expr);

  // Compile with 'with' to provide context variables as globals
  // This is safe because we've sanitized the expression
  fn = new Function(
    "ctx",
    `with(ctx) { return Boolean(${sanitized}); }`
  ) as (ctx: ExprContext) => boolean;

  exprCache.set(expr, fn);
  return fn;
}

export function evalExpr(expr: string, context: ExprContext): boolean {
  try {
    const fn = compileExpr(expr);
    return fn(context);
  } catch (err) {
    if (err instanceof ExprError) throw err;
    throw new ExprError(`Failed to evaluate expression "${expr}": ${err}`);
  }
}

// =============================================================================
// Fact Processing
// =============================================================================

const IF_SIGIL = "$if ";

export interface ProcessedFact {
  content: string;
  conditional: boolean;
  expression?: string;
}

/**
 * Parse a fact, detecting $if prefix.
 */
export function parseFact(fact: string): ProcessedFact {
  const trimmed = fact.trim();

  if (trimmed.startsWith(IF_SIGIL)) {
    const rest = trimmed.slice(IF_SIGIL.length);
    const colonIdx = rest.indexOf(":");
    if (colonIdx === -1) {
      throw new ExprError(`Invalid $if fact, missing colon: ${fact}`);
    }
    const expression = rest.slice(0, colonIdx).trim();
    const content = rest.slice(colonIdx + 1).trim();
    return { content, conditional: true, expression };
  }

  return { content: trimmed, conditional: false };
}

/**
 * Evaluate a list of facts, returning only those that apply.
 * Non-conditional facts always apply.
 * Conditional facts apply if their expression evaluates to true.
 */
export function evaluateFacts(
  facts: string[],
  context: ExprContext
): string[] {
  const results: string[] = [];

  for (const fact of facts) {
    const parsed = parseFact(fact);

    if (!parsed.conditional) {
      results.push(parsed.content);
      continue;
    }

    if (parsed.expression && evalExpr(parsed.expression, context)) {
      results.push(parsed.content);
    }
  }

  return results;
}

// =============================================================================
// Error Type
// =============================================================================

export class ExprError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExprError";
  }
}

// =============================================================================
// Context Factory
// =============================================================================

/**
 * Create a base context with standard globals.
 * Caller should extend with entity-specific data.
 */
export function createBaseContext(
  hasFact: (pattern: string) => boolean
): ExprContext {
  const now = new Date();
  const hour = now.getHours();

  return {
    random: (chance: number) => Math.random() < chance,
    hasFact,
    roll: (dice: string) => rollDice(dice),
    time: {
      hour,
      isDay: hour >= 6 && hour < 18,
      isNight: hour < 6 || hour >= 18,
    },
  };
}

/**
 * Simple dice roller: "2d6+3" -> random result
 */
function rollDice(expr: string): number {
  const match = expr.match(/^(\d+)d(\d+)([+-]\d+)?$/);
  if (!match) {
    throw new ExprError(`Invalid dice expression: ${expr}`);
  }

  const count = parseInt(match[1]);
  const sides = parseInt(match[2]);
  const modifier = match[3] ? parseInt(match[3]) : 0;

  let total = modifier;
  for (let i = 0; i < count; i++) {
    total += Math.floor(Math.random() * sides) + 1;
  }

  return total;
}
