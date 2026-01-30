/**
 * Minimal template engine with Nunjucks-compatible syntax.
 * All expressions are evaluated through expr.ts's sandbox.
 *
 * Supported syntax:
 *   {{ expr }}                           — expression output
 *   {% if expr %}...{% elif expr %}...{% else %}...{% endif %}
 *   {% for var in expr %}...{% endfor %}
 *   {# comment #}
 *
 * No macros, imports, includes, extends, set, or filters.
 */

import { compileTemplateExpr, ExprError, type ExprContext } from "../logic/expr";

// =============================================================================
// Limits
// =============================================================================

/** Maximum iterations per for-loop */
const MAX_LOOP_ITERATIONS = 1000;

/** Maximum output length in bytes */
const MAX_OUTPUT_LENGTH = 1_000_000;

// =============================================================================
// Tokenizer
// =============================================================================

type TemplateTokenType = "text" | "expr" | "tag" | "comment";

interface TemplateToken {
  type: TemplateTokenType;
  content: string;
  pos: number;
}

/**
 * Tokenize template source into text/expr/tag/comment tokens.
 * Scans for {{ }}, {% %}, {# #} delimiters.
 */
function tokenize(source: string): TemplateToken[] {
  const tokens: TemplateToken[] = [];
  let pos = 0;

  while (pos < source.length) {
    // Find the next opening delimiter
    const exprStart = source.indexOf("{{", pos);
    const tagStart = source.indexOf("{%", pos);
    const commentStart = source.indexOf("{#", pos);

    // Find the earliest delimiter
    let earliest = source.length;
    let type: "expr" | "tag" | "comment" | null = null;
    let openLen = 0;
    let closeDelim = "";

    if (exprStart >= 0 && exprStart < earliest) {
      earliest = exprStart;
      type = "expr";
      openLen = 2;
      closeDelim = "}}";
    }
    if (tagStart >= 0 && tagStart < earliest) {
      earliest = tagStart;
      type = "tag";
      openLen = 2;
      closeDelim = "%}";
    }
    if (commentStart >= 0 && commentStart < earliest) {
      earliest = commentStart;
      type = "comment";
      openLen = 2;
      closeDelim = "#}";
    }

    // Emit text before the delimiter
    if (earliest > pos) {
      tokens.push({ type: "text", content: source.slice(pos, earliest), pos });
    }

    if (type === null) {
      // No more delimiters
      break;
    }

    // Find the closing delimiter
    const closeStart = source.indexOf(closeDelim, earliest + openLen);
    if (closeStart < 0) {
      throw new ExprError(`Unclosed ${type === "expr" ? "{{" : type === "tag" ? "{%" : "{#"} at position ${earliest}`);
    }

    const inner = source.slice(earliest + openLen, closeStart).trim();
    tokens.push({ type, content: inner, pos: earliest });
    pos = closeStart + closeDelim.length;
  }

  return tokens;
}

// =============================================================================
// AST
// =============================================================================

type TemplateNode =
  | { type: "text"; content: string }
  | { type: "expr"; source: string; evaluate: (ctx: ExprContext) => unknown }
  | {
      type: "if";
      branches: Array<{
        source: string;
        condition: (ctx: ExprContext) => unknown;
        body: TemplateNode[];
      }>;
      elseBranch?: TemplateNode[];
    }
  | {
      type: "for";
      varName: string;
      source: string;
      iterable: (ctx: ExprContext) => unknown;
      body: TemplateNode[];
    };

export interface CompiledTemplate {
  nodes: TemplateNode[];
  source: string;
}

// =============================================================================
// Parser
// =============================================================================

/**
 * Parse tokenized template into an AST.
 * Recursive descent: if/elif/else/endif and for/endfor blocks nest.
 */
function parse(tokens: TemplateToken[], extraGlobals: Set<string>): TemplateNode[] {
  let pos = 0;

  function parseBody(stopTags: string[]): TemplateNode[] {
    const nodes: TemplateNode[] = [];

    while (pos < tokens.length) {
      const token = tokens[pos];

      if (token.type === "text") {
        nodes.push({ type: "text", content: token.content });
        pos++;
        continue;
      }

      if (token.type === "comment") {
        // Skip comments
        pos++;
        continue;
      }

      if (token.type === "expr") {
        const evaluate = compileTemplateExpr(token.content, extraGlobals);
        nodes.push({ type: "expr", source: token.content, evaluate });
        pos++;
        continue;
      }

      // Tag token
      if (token.type === "tag") {
        const tagContent = token.content;

        // Check for stop tags
        const tagKeyword = tagContent.split(/\s+/)[0];
        if (stopTags.includes(tagKeyword)) {
          // Don't consume - let caller handle
          return nodes;
        }

        if (tagKeyword === "if") {
          nodes.push(parseIf(extraGlobals));
          continue;
        }

        if (tagKeyword === "for") {
          nodes.push(parseFor(extraGlobals));
          continue;
        }

        throw new ExprError(`Unknown template tag: ${tagKeyword} at position ${token.pos}`);
      }
    }

    return nodes;
  }

  function parseIf(globals: Set<string>): TemplateNode {
    // Current token is {% if expr %}
    const firstToken = tokens[pos];
    const condExpr = firstToken.content.slice(2).trim(); // strip "if"
    pos++;

    const condition = compileTemplateExpr(condExpr, globals);
    const body = parseBody(["elif", "else", "endif"]);

    const branches: Array<{
      source: string;
      condition: (ctx: ExprContext) => unknown;
      body: TemplateNode[];
    }> = [{ source: condExpr, condition, body }];

    let elseBranch: TemplateNode[] | undefined;

    // Process elif/else/endif
    while (pos < tokens.length) {
      const token = tokens[pos];
      if (token.type !== "tag") {
        throw new ExprError(`Expected elif/else/endif, got ${token.type} at position ${token.pos}`);
      }

      const keyword = token.content.split(/\s+/)[0];

      if (keyword === "elif") {
        const elifExpr = token.content.slice(4).trim();
        pos++;
        const elifCondition = compileTemplateExpr(elifExpr, globals);
        const elifBody = parseBody(["elif", "else", "endif"]);
        branches.push({ source: elifExpr, condition: elifCondition, body: elifBody });
        continue;
      }

      if (keyword === "else") {
        pos++;
        elseBranch = parseBody(["endif"]);
        continue;
      }

      if (keyword === "endif") {
        pos++;
        break;
      }

      throw new ExprError(`Unexpected tag in if block: ${keyword} at position ${token.pos}`);
    }

    return {
      type: "if",
      branches,
      elseBranch,
    };
  }

  function parseFor(globals: Set<string>): TemplateNode {
    // Current token is {% for var in expr %}
    const token = tokens[pos];
    const forContent = token.content.slice(3).trim(); // strip "for"
    pos++;

    // Parse "var in expr"
    const inIndex = forContent.indexOf(" in ");
    if (inIndex < 0) {
      throw new ExprError(`Invalid for syntax: expected "for var in expr" at position ${token.pos}`);
    }

    const varName = forContent.slice(0, inIndex).trim();
    const iterableExpr = forContent.slice(inIndex + 4).trim();

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(varName)) {
      throw new ExprError(`Invalid loop variable name: ${varName}`);
    }

    // Add loop variable and "loop" metadata to extra globals for body expressions
    const innerGlobals = new Set(globals);
    innerGlobals.add(varName);
    innerGlobals.add("loop");

    const iterable = compileTemplateExpr(iterableExpr, innerGlobals);
    const body = parseBody(["endfor"]);

    // Consume endfor
    if (pos < tokens.length && tokens[pos].type === "tag" && tokens[pos].content.trim() === "endfor") {
      pos++;
    } else {
      throw new ExprError(`Missing endfor for loop at position ${token.pos}`);
    }

    return { type: "for", varName, source: iterableExpr, iterable, body };
  }

  const nodes = parseBody([]);

  if (pos < tokens.length) {
    throw new ExprError(`Unexpected token at position ${tokens[pos].pos}: ${tokens[pos].content}`);
  }

  return nodes;
}

// =============================================================================
// Renderer
// =============================================================================

/**
 * Render a compiled template with the given expression context.
 * For-loops use Object.create(ctx) to shadow loop variables.
 */
export function renderTemplate(template: CompiledTemplate, ctx: ExprContext): string {
  let output = "";
  let outputLength = 0;

  function checkOutput(addition: string) {
    outputLength += addition.length;
    if (outputLength > MAX_OUTPUT_LENGTH) {
      throw new ExprError(
        `Template output exceeds ${MAX_OUTPUT_LENGTH.toLocaleString()} character limit`
      );
    }
  }

  function renderNodes(nodes: TemplateNode[], context: ExprContext): void {
    for (const node of nodes) {
      switch (node.type) {
        case "text": {
          checkOutput(node.content);
          output += node.content;
          break;
        }

        case "expr": {
          const value = node.evaluate(context);
          const str = value == null ? "" : String(value);
          checkOutput(str);
          output += str;
          break;
        }

        case "if": {
          let matched = false;
          for (const branch of node.branches) {
            if (branch.condition(context)) {
              renderNodes(branch.body, context);
              matched = true;
              break;
            }
          }
          if (!matched && node.elseBranch) {
            renderNodes(node.elseBranch, context);
          }
          break;
        }

        case "for": {
          const items = node.iterable(context);
          if (!items || typeof items !== "object" || !(Symbol.iterator in items)) {
            throw new ExprError(`for-loop iterable is not iterable: ${node.source}`);
          }

          const arr = Array.from(items as Iterable<unknown>);

          if (arr.length > MAX_LOOP_ITERATIONS) {
            throw new ExprError(
              `for-loop would iterate ${arr.length} times (limit: ${MAX_LOOP_ITERATIONS})`
            );
          }

          for (let i = 0; i < arr.length; i++) {
            // Create scoped context with loop variable and loop metadata
            const loopCtx = Object.create(context) as ExprContext;
            loopCtx[node.varName] = arr[i];
            loopCtx.loop = Object.assign(Object.create(null), {
              index: i,
              index0: i,
              index1: i + 1,
              first: i === 0,
              last: i === arr.length - 1,
              length: arr.length,
            });

            renderNodes(node.body, loopCtx);
          }
          break;
        }
      }
    }
  }

  renderNodes(template.nodes, ctx);
  return output;
}

// =============================================================================
// Compilation & Caching
// =============================================================================

const templateCache = new Map<string, CompiledTemplate>();

/**
 * Compile a template source string into a CompiledTemplate.
 * Results are cached by source string.
 */
export function compileTemplate(source: string, extraGlobals?: Set<string>): CompiledTemplate {
  const cacheKey = extraGlobals && extraGlobals.size > 0
    ? `${source}\0${[...extraGlobals].sort().join(",")}`
    : source;

  let compiled = templateCache.get(cacheKey);
  if (compiled) return compiled;

  const tokens = tokenize(source);
  const globals = new Set(extraGlobals ?? []);
  const nodes = parse(tokens, globals);

  compiled = { nodes, source };
  templateCache.set(cacheKey, compiled);
  return compiled;
}
