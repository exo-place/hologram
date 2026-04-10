/**
 * Expression compiler for $if conditional facts.
 *
 * Provides tokenizer, parser, code generator, and compiled expression cache.
 * Exports ExprError, Tokenizer, Parser, and all compile/eval functions.
 */

import { validateRegexPattern } from "./safe-regex";
import type { ExprContext } from "./expr";

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
// Tokenizer
// =============================================================================

type TokenType =
  | "number"
  | "string"
  | "boolean"
  | "identifier"
  | "operator"
  | "paren"
  | "dot"
  | "comma"
  | "eof";

interface Token {
  type: TokenType;
  value: string | number | boolean;
  raw: string;
  /** Position in original string where this token starts */
  pos: number;
}

const OPERATORS = [
  "&&", "||", "===", "!==", "==", "!=", "<=", ">=", "<", ">",
  "+", "-", "*", "/", "%", "!", "?", ":"
];

/**
 * Lazy tokenizer that produces tokens on demand.
 * This is crucial for parseCondition to avoid tokenizing content after the colon.
 */
export class Tokenizer {
  private expr: string;
  private pos = 0;
  private peeked: Token | null = null;

  constructor(expr: string) {
    this.expr = expr;
  }

  /** Get current position in the expression */
  getPos(): number {
    return this.peeked ? this.peeked.pos : this.pos;
  }

  /** Peek at next token without consuming */
  peek(): Token {
    if (this.peeked) return this.peeked;
    this.peeked = this.nextToken();
    return this.peeked;
  }

  /** Consume and return next token */
  next(): Token {
    if (this.peeked) {
      const t = this.peeked;
      this.peeked = null;
      return t;
    }
    return this.nextToken();
  }

  /** Internal: read the next token from the expression */
  private nextToken(): Token {
    const expr = this.expr;

    // Skip whitespace
    while (this.pos < expr.length && /\s/.test(expr[this.pos])) {
      this.pos++;
    }

    if (this.pos >= expr.length) {
      return { type: "eof", value: "", raw: "", pos: this.pos };
    }

    const start = this.pos;

    // Number
    if (/\d/.test(expr[this.pos]) || (expr[this.pos] === "." && /\d/.test(expr[this.pos + 1]))) {
      let num = "";
      while (this.pos < expr.length && /[\d.]/.test(expr[this.pos])) {
        num += expr[this.pos++];
      }
      return { type: "number", value: parseFloat(num), raw: num, pos: start };
    }

    // String (double or single quotes)
    if (expr[this.pos] === '"' || expr[this.pos] === "'") {
      const quote = expr[this.pos++];
      let str = "";
      while (this.pos < expr.length && expr[this.pos] !== quote) {
        if (expr[this.pos] === "\\") {
          this.pos++; // skip backslash
          if (this.pos < expr.length) str += expr[this.pos++];
        } else {
          str += expr[this.pos++];
        }
      }
      if (expr[this.pos] !== quote) throw new ExprError("Unterminated string");
      this.pos++; // skip closing quote
      return { type: "string", value: str, raw: `${quote}${str}${quote}`, pos: start };
    }

    // Identifier or boolean
    if (/[a-zA-Z_]/.test(expr[this.pos])) {
      let id = "";
      while (this.pos < expr.length && /[a-zA-Z0-9_]/.test(expr[this.pos])) {
        id += expr[this.pos++];
      }
      if (id === "true") {
        return { type: "boolean", value: true, raw: id, pos: start };
      } else if (id === "false") {
        return { type: "boolean", value: false, raw: id, pos: start };
      } else {
        return { type: "identifier", value: id, raw: id, pos: start };
      }
    }

    // Operators (try longest match first)
    for (const op of OPERATORS) {
      if (expr.slice(this.pos, this.pos + op.length) === op) {
        this.pos += op.length;
        return { type: "operator", value: op, raw: op, pos: start };
      }
    }

    // Parentheses
    if (expr[this.pos] === "(" || expr[this.pos] === ")") {
      const ch = expr[this.pos++];
      return { type: "paren", value: ch, raw: ch, pos: start };
    }

    // Dot
    if (expr[this.pos] === ".") {
      this.pos++;
      return { type: "dot", value: ".", raw: ".", pos: start };
    }

    // Comma
    if (expr[this.pos] === ",") {
      this.pos++;
      return { type: "comma", value: ",", raw: ",", pos: start };
    }

    // Unknown character
    throw new ExprError(`Unexpected character: ${expr[this.pos]}`);
  }
}

/** Eager tokenize - used for full expression compilation */
function tokenize(expr: string): Token[] {
  const tokenizer = new Tokenizer(expr);
  const tokens: Token[] = [];
  while (true) {
    const token = tokenizer.next();
    tokens.push(token);
    if (token.type === "eof") break;
  }
  return tokens;
}

// =============================================================================
// Parser & Evaluator
// =============================================================================

type ExprNode =
  | { type: "literal"; value: string | number | boolean }
  | { type: "identifier"; name: string }
  | { type: "member"; object: ExprNode; property: string }
  | { type: "call"; callee: ExprNode; args: ExprNode[] }
  | { type: "unary"; operator: string; operand: ExprNode }
  | { type: "binary"; operator: string; left: ExprNode; right: ExprNode }
  | { type: "ternary"; test: ExprNode; consequent: ExprNode; alternate: ExprNode };

/** Token source interface - works with both eager Token[] and lazy Tokenizer */
interface TokenSource {
  peek(): Token;
  next(): Token;
  getPos(): number;
}

/** Adapter to use Token[] as TokenSource */
class ArrayTokenSource implements TokenSource {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  peek(): Token {
    return this.tokens[this.pos];
  }

  next(): Token {
    return this.tokens[this.pos++];
  }

  getPos(): number {
    return this.tokens[this.pos]?.pos ?? this.tokens[this.tokens.length - 1].pos;
  }
}

export class Parser {
  private source: TokenSource;

  constructor(source: Token[] | TokenSource) {
    this.source = Array.isArray(source) ? new ArrayTokenSource(source) : source;
  }

  private peek(): Token {
    return this.source.peek();
  }

  private consume(): Token {
    return this.source.next();
  }

  private expect(type: TokenType, value?: string | number | boolean): Token {
    const token = this.consume();
    if (token.type !== type || (value !== undefined && token.value !== value)) {
      throw new ExprError(`Expected ${type}${value !== undefined ? ` '${value}'` : ""}, got ${token.type} '${token.raw}'`);
    }
    return token;
  }

  parse(): ExprNode {
    const node = this.parseTernary();
    if (this.peek().type !== "eof") {
      throw new ExprError(`Unexpected token: ${this.peek().raw}`);
    }
    return node;
  }

  /** Parse expression without expecting EOF, return next token and position */
  parseExprLazy(): { token: Token; pos: number } {
    this.parseTernary();
    return { token: this.peek(), pos: this.source.getPos() };
  }


  private parseTernary(): ExprNode {
    let node = this.parseOr();
    if (this.peek().type === "operator" && this.peek().value === "?") {
      this.consume(); // ?
      const consequent = this.parseTernary();
      this.expect("operator", ":");
      const alternate = this.parseTernary();
      node = { type: "ternary", test: node, consequent, alternate };
    }
    return node;
  }

  private parseOr(): ExprNode {
    let node = this.parseAnd();
    while (this.peek().type === "operator" && this.peek().value === "||") {
      this.consume();
      node = { type: "binary", operator: "||", left: node, right: this.parseAnd() };
    }
    return node;
  }

  private parseAnd(): ExprNode {
    let node = this.parseEquality();
    while (this.peek().type === "operator" && this.peek().value === "&&") {
      this.consume();
      node = { type: "binary", operator: "&&", left: node, right: this.parseEquality() };
    }
    return node;
  }

  private parseEquality(): ExprNode {
    let node = this.parseComparison();
    while (this.peek().type === "operator" && ["==", "!=", "===", "!=="].includes(this.peek().value as string)) {
      const op = this.consume().value as string;
      node = { type: "binary", operator: op, left: node, right: this.parseComparison() };
    }
    return node;
  }

  private parseComparison(): ExprNode {
    let node = this.parseAdditive();
    while (this.peek().type === "operator" && ["<", ">", "<=", ">="].includes(this.peek().value as string)) {
      const op = this.consume().value as string;
      node = { type: "binary", operator: op, left: node, right: this.parseAdditive() };
    }
    return node;
  }

  private parseAdditive(): ExprNode {
    let node = this.parseMultiplicative();
    while (this.peek().type === "operator" && (this.peek().value === "+" || this.peek().value === "-")) {
      const op = this.consume().value as string;
      node = { type: "binary", operator: op, left: node, right: this.parseMultiplicative() };
    }
    return node;
  }

  private parseMultiplicative(): ExprNode {
    let node = this.parseUnary();
    while (this.peek().type === "operator" && ["*", "/", "%"].includes(this.peek().value as string)) {
      const op = this.consume().value as string;
      node = { type: "binary", operator: op, left: node, right: this.parseUnary() };
    }
    return node;
  }

  private parseUnary(): ExprNode {
    if (this.peek().type === "operator" && (this.peek().value === "!" || this.peek().value === "-")) {
      const op = this.consume().value as string;
      return { type: "unary", operator: op, operand: this.parseUnary() };
    }
    return this.parsePostfix();
  }

  /** Parse member access and calls in a single loop to support chaining like foo().bar().baz */
  private parsePostfix(): ExprNode {
    let node = this.parsePrimary();
    while (true) {
      if (this.peek().type === "dot") {
        this.consume(); // .
        const prop = this.expect("identifier").value as string;
        node = { type: "member", object: node, property: prop };
      } else if (this.peek().type === "paren" && this.peek().value === "(") {
        this.consume(); // (
        const args: ExprNode[] = [];
        if (!(this.peek().type === "paren" && this.peek().value === ")")) {
          args.push(this.parseTernary());
          while (this.peek().type === "comma") {
            this.consume();
            args.push(this.parseTernary());
          }
        }
        this.expect("paren", ")");
        node = { type: "call", callee: node, args };
      } else {
        break;
      }
    }
    return node;
  }

  private parsePrimary(): ExprNode {
    const token = this.peek();

    if (token.type === "number" || token.type === "string" || token.type === "boolean") {
      this.consume();
      return { type: "literal", value: token.value };
    }

    if (token.type === "identifier") {
      this.consume();
      return { type: "identifier", name: token.value as string };
    }

    if (token.type === "paren" && token.value === "(") {
      this.consume();
      const node = this.parseTernary();
      this.expect("paren", ")");
      return node;
    }

    throw new ExprError(`Unexpected token: ${token.raw}`);
  }
}

// Derive allowed globals from ExprContext - TypeScript ensures this stays in sync
const EXPR_CONTEXT_REFERENCE: ExprContext = {
  self: {},
  random: () => 0,
  has_fact: () => false,
  roll: () => 0,
  time: { hour: 0, is_day: false, is_night: false },
  response_ms: 0,
  retry_ms: 0,
  idle_ms: 0,
  unread_count: 0,
  mentioned: false,
  replied: false,
  replied_to: "",
  is_forward: false,
  is_self: false,
  is_hologram: false,
      silent: false,
  mentioned_in_dialogue: () => false,
  content: "",
  author: "",
  name: "",
  chars: [],
  messages: () => "",
  group: "",
  duration: () => "",
  date_str: () => "",
  time_str: () => "",
  isodate: () => "",
  isotime: () => "",
  weekday: () => "",
  pick: () => undefined,
  interaction_type: "",
  keyword_match: false,
  channel: { id: "", name: "", description: "", is_nsfw: false, type: "text", mention: "" },
  server: { id: "", name: "", description: "", nsfw_level: "default" },
  Date: { new: () => new globalThis.Date(), now: () => 0, parse: () => 0, UTC: () => 0 },
};
const ALLOWED_GLOBALS = new Set(Object.keys(EXPR_CONTEXT_REFERENCE));

// Methods that compile their first string argument into a RegExp
const REGEX_METHODS = new Set(["match", "search", "replace", "split"]);

// Methods blocked entirely (no useful expression-language interaction)
// Uses Map to avoid prototype chain lookup issues (e.g. "toString" in {})
const BLOCKED_METHODS = new Map([
  ["matchAll", "matchAll() is not available — use match() instead"],
]);

// Methods rewritten to use safe wrappers at runtime (memory exhaustion prevention)
const WRAPPED_METHODS = new Set(["repeat", "padStart", "padEnd", "replaceAll", "join"]);

// Blocked property names (prevent prototype chain escapes)
// Uses Map because a plain object's __proto__ key collides with the actual prototype
const BLOCKED_PROPERTIES = new Map([
  ["constructor", "Blocked property: .constructor — accessing constructors could allow sandbox escape"],
  ["__proto__", "Blocked property: .__proto__ — accessing prototypes could allow sandbox escape"],
  ["prototype", "Blocked property: .prototype — accessing prototypes could allow sandbox escape"],
  ["__defineGetter__", "Blocked property: .__defineGetter__ — modifying property descriptors is not allowed"],
  ["__defineSetter__", "Blocked property: .__defineSetter__ — modifying property descriptors is not allowed"],
  ["__lookupGetter__", "Blocked property: .__lookupGetter__ — inspecting property descriptors is not allowed"],
  ["__lookupSetter__", "Blocked property: .__lookupSetter__ — inspecting property descriptors is not allowed"],
]);

// =============================================================================
// Safe Method Wrappers (injected at runtime as $s)
// =============================================================================

/** Max characters a string-producing method can output */
const MAX_STRING_OUTPUT = 100_000;

const SAFE_METHODS = {
  repeat(str: unknown, count: unknown): string {
    if (typeof str !== "string") {
      throw new ExprError("repeat() can only be called on a string");
    }
    const n = Number(count);
    if (!Number.isFinite(n) || n < 0 || n !== Math.floor(n)) {
      throw new ExprError("repeat() count must be a non-negative integer");
    }
    const outputLen = str.length * n;
    if (outputLen > MAX_STRING_OUTPUT) {
      throw new ExprError(
        `repeat(${n}) would produce ${outputLen.toLocaleString()} characters (limit: ${MAX_STRING_OUTPUT.toLocaleString()})`
      );
    }
    return str.repeat(n);
  },

  padStart(str: unknown, len: unknown, fill?: unknown): string {
    if (typeof str !== "string") {
      throw new ExprError("padStart() can only be called on a string");
    }
    const n = Number(len);
    if (!Number.isFinite(n) || n < 0) {
      throw new ExprError("padStart() length must be a non-negative number");
    }
    if (n > MAX_STRING_OUTPUT) {
      throw new ExprError(
        `padStart(${n}) target length exceeds limit (${MAX_STRING_OUTPUT.toLocaleString()})`
      );
    }
    return fill !== undefined ? str.padStart(n, String(fill)) : str.padStart(n);
  },

  padEnd(str: unknown, len: unknown, fill?: unknown): string {
    if (typeof str !== "string") {
      throw new ExprError("padEnd() can only be called on a string");
    }
    const n = Number(len);
    if (!Number.isFinite(n) || n < 0) {
      throw new ExprError("padEnd() length must be a non-negative number");
    }
    if (n > MAX_STRING_OUTPUT) {
      throw new ExprError(
        `padEnd(${n}) target length exceeds limit (${MAX_STRING_OUTPUT.toLocaleString()})`
      );
    }
    return fill !== undefined ? str.padEnd(n, String(fill)) : str.padEnd(n);
  },

  replaceAll(str: unknown, search: unknown, replacement: unknown): string {
    if (typeof str !== "string") {
      throw new ExprError("replaceAll() can only be called on a string");
    }
    const result = str.replaceAll(String(search), String(replacement));
    if (result.length > MAX_STRING_OUTPUT) {
      throw new ExprError(
        `replaceAll() produced ${result.length.toLocaleString()} characters (limit: ${MAX_STRING_OUTPUT.toLocaleString()})`
      );
    }
    return result;
  },

  join(arr: unknown, sep?: unknown): string {
    if (!Array.isArray(arr)) {
      throw new ExprError("join() can only be called on an array");
    }
    const result = sep !== undefined ? arr.join(String(sep)) : arr.join();
    if (result.length > MAX_STRING_OUTPUT) {
      throw new ExprError(
        `join() produced ${result.length.toLocaleString()} characters (limit: ${MAX_STRING_OUTPUT.toLocaleString()})`
      );
    }
    return result;
  },
};

/**
 * Generate JS code from AST. Since we control the AST structure,
 * the generated code is safe to execute.
 *
 * @param extraGlobals - Optional set of additional allowed identifiers (e.g. for-loop variables in templates)
 */
function generateCode(node: ExprNode, extraGlobals?: Set<string>): string {
  switch (node.type) {
    case "literal":
      if (typeof node.value === "string") {
        return JSON.stringify(node.value);
      }
      return String(node.value);

    case "identifier":
      if (!ALLOWED_GLOBALS.has(node.name) && !extraGlobals?.has(node.name)) {
        throw new ExprError(`Unknown identifier: ${node.name}`);
      }
      return `ctx.${node.name}`;

    case "member": {
      // Block dangerous property names that could escape the sandbox.
      //
      // This is an intentional blocklist rather than a whitelist. A whitelist is not
      // viable here because property names in member access are user-defined: expressions
      // like `self.health`, `self.fox_tf`, `channel.name`, `server.description` depend on
      // arbitrary fact names and Discord metadata fields chosen by entity authors. Any
      // practical whitelist would need to enumerate every possible key, which is unbounded.
      //
      // The blocklist is complete for prototype chain escape: the blocked set covers every
      // property name that grants access to an object's prototype chain or descriptor API:
      //   - `constructor`      → Function constructor → arbitrary code
      //   - `__proto__`        → direct prototype chain access
      //   - `prototype`        → constructor prototype manipulation
      //   - `__defineGetter__` / `__defineSetter__`    → getter/setter injection
      //   - `__lookupGetter__` / `__lookupSetter__`    → descriptor inspection
      // Bracket notation (computed property access like `obj["__proto__"]`) is not parsed
      // by the expression grammar — only dot-notation member access is supported. This
      // makes the attack surface static: property names are always string literals in the
      // AST, enumerable at compile time, fully covered by the blocklist.
      const blockedMsg = BLOCKED_PROPERTIES.get(node.property);
      if (blockedMsg) {
        throw new ExprError(blockedMsg);
      }
      // Block methods that are unusable or dangerous
      const blockedMethodMsg = BLOCKED_METHODS.get(node.property);
      if (blockedMethodMsg) {
        throw new ExprError(blockedMethodMsg);
      }
      return `(${generateCode(node.object, extraGlobals)}?.${node.property})`;
    }

    case "call": {
      if (node.callee.type === "member") {
        // Validate regex patterns for methods that compile strings to RegExp
        if (REGEX_METHODS.has(node.callee.property)) {
          const firstArg = node.args[0];
          if (!firstArg || firstArg.type !== "literal" || typeof firstArg.value !== "string") {
            throw new ExprError(
              `${node.callee.property}() requires a string literal pattern ` +
              `(dynamic patterns are not allowed for security)`
            );
          }
          validateRegexPattern(firstArg.value as string);
        }
        // Rewrite memory-dangerous methods to use safe wrappers
        if (WRAPPED_METHODS.has(node.callee.property)) {
          const obj = generateCode(node.callee.object, extraGlobals);
          const args = node.args.map(a => generateCode(a, extraGlobals)).join(", ");
          return `$s.${node.callee.property}(${obj}${args ? ", " + args : ""})`;
        }
      }
      const callee = generateCode(node.callee, extraGlobals);
      const args = node.args.map(a => generateCode(a, extraGlobals)).join(", ");
      return `${callee}(${args})`;
    }

    case "unary":
      return `(${node.operator}${generateCode(node.operand, extraGlobals)})`;

    case "binary":
      return `(${generateCode(node.left, extraGlobals)} ${node.operator} ${generateCode(node.right, extraGlobals)})`;

    case "ternary":
      return `(${generateCode(node.test, extraGlobals)} ? ${generateCode(node.consequent, extraGlobals)} : ${generateCode(node.alternate, extraGlobals)})`;
  }
}

// =============================================================================
// Compilation & Caching
// =============================================================================

const exprCache = new Map<string, (ctx: ExprContext) => boolean>();

export function compileExpr(expr: string): (ctx: ExprContext) => boolean {
  let fn = exprCache.get(expr);
  if (fn) return fn;

  const tokens = tokenize(expr);
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const code = generateCode(ast);

  // Safe: we generated this code from a validated AST
  // $s provides safe wrappers for memory-dangerous methods (repeat, padStart, padEnd)
  const raw = new Function("ctx", "$s", `return Boolean(${code})`);
  fn = (ctx: ExprContext) => raw(ctx, SAFE_METHODS);

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

// Separate cache for template expressions (returns raw value, supports extraGlobals)
const templateExprCache = new Map<string, (ctx: ExprContext) => unknown>();

/**
 * Compile an expression for use in templates.
 * Returns the raw value (not cast to boolean).
 * Accepts optional extra allowed identifiers (e.g. for-loop variables).
 */
export function compileTemplateExpr(
  expr: string,
  extraGlobals?: Set<string>
): (ctx: ExprContext) => unknown {
  const cacheKey = extraGlobals && extraGlobals.size > 0
    ? `${expr}\0${[...extraGlobals].sort().join(",")}`
    : expr;

  let fn = templateExprCache.get(cacheKey);
  if (fn) return fn;

  const tokens = tokenize(expr);
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const code = generateCode(ast, extraGlobals);

  const raw = new Function("ctx", "$s", `return (${code})`);
  fn = (ctx: ExprContext) => raw(ctx, SAFE_METHODS);
  templateExprCache.set(cacheKey, fn);
  return fn;
}

// Separate cache for macro expressions (returns raw value, not boolean)
const macroExprCache = new Map<string, (ctx: ExprContext) => unknown>();

function compileMacroExpr(expr: string): (ctx: ExprContext) => unknown {
  let fn = macroExprCache.get(expr);
  if (fn) return fn;

  const tokens = tokenize(expr);
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const code = generateCode(ast);

  const raw = new Function("ctx", "$s", `return (${code})`);
  fn = (ctx: ExprContext) => raw(ctx, SAFE_METHODS);
  macroExprCache.set(expr, fn);
  return fn;
}

/**
 * Evaluate an expression and return its string value (for macro expansion).
 * Returns "" for null/undefined results.
 */
export function evalMacroValue(expr: string, context: ExprContext): string {
  try {
    const fn = compileMacroExpr(expr);
    const result = fn(context);
    if (result == null) return "";
    return String(result);
  } catch (err) {
    if (err instanceof ExprError) throw err;
    throw new ExprError(`Failed to evaluate macro "${expr}": ${err}`);
  }
}

/**
 * Evaluate an expression and return the raw result without type conversion.
 * Used for testing and cases where the actual value type matters.
 */
export function evalRaw(expr: string, context: ExprContext): unknown {
  try {
    const fn = compileMacroExpr(expr);
    return fn(context);
  } catch (err) {
    if (err instanceof ExprError) throw err;
    throw new ExprError(`Failed to evaluate expression "${expr}": ${err}`);
  }
}
