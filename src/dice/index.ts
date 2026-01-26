import { getComputedAttributes } from "../state";

/**
 * Dice rolling system with expression parser.
 *
 * Supports:
 * - Basic: 3d6, d20+5, 2d6+1d4+3
 * - Keep highest/lowest: 4d6kh3, 2d20kh1
 * - Drop highest/lowest: 4d6dl1
 * - Exploding: d6!, d6!>4
 * - Reroll: d20r1, d20ro<3
 * - Count successes: 8d6>=5
 * - Math: +, -, *, /, parentheses
 * - Variables: @strength, @prof
 * - Natural 20/1 detection for d20
 */

export interface DiceRoll {
  expression: string;
  rolls: IndividualRoll[];
  total: number;
  details: string;
  critical?: "success" | "failure";
}

export interface IndividualRoll {
  count: number;
  sides: number;
  results: number[];
  kept: number[];
  modifier?: string;
  subtotal: number;
}

interface Token {
  type: "dice" | "number" | "op" | "lparen" | "rparen" | "variable";
  value: string;
}

// Tokenize the expression
function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = expr.replace(/\s+/g, "");

  while (i < s.length) {
    // Variable: @identifier
    if (s[i] === "@") {
      let name = "";
      i++;
      while (i < s.length && /[a-zA-Z_0-9]/.test(s[i])) {
        name += s[i];
        i++;
      }
      tokens.push({ type: "variable", value: name });
      continue;
    }

    // Dice notation: [count]d<sides>[modifiers]
    // Match patterns like: d20, 2d6, 4d6kh3, d20+5, d6!, 8d6>=5
    const diceMatch = s.slice(i).match(/^(\d*)d(\d+)((?:kh|kl|dh|dl)\d+|!(?:>?\d+)?|ro?(?:<?\d+)?|>=?\d+|<=?\d+)?/i);
    if (diceMatch) {
      tokens.push({ type: "dice", value: diceMatch[0] });
      i += diceMatch[0].length;
      continue;
    }

    // Number
    if (/\d/.test(s[i])) {
      let num = "";
      while (i < s.length && /\d/.test(s[i])) {
        num += s[i];
        i++;
      }
      tokens.push({ type: "number", value: num });
      continue;
    }

    // Operators
    if ("+-*/".includes(s[i])) {
      tokens.push({ type: "op", value: s[i] });
      i++;
      continue;
    }

    // Parentheses
    if (s[i] === "(") {
      tokens.push({ type: "lparen", value: "(" });
      i++;
      continue;
    }
    if (s[i] === ")") {
      tokens.push({ type: "rparen", value: ")" });
      i++;
      continue;
    }

    // Unknown character, skip
    i++;
  }

  return tokens;
}

// Roll a single die
function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

// Process a dice token
function processDice(token: string): IndividualRoll {
  const match = token.match(/^(\d*)d(\d+)((?:kh|kl|dh|dl)\d+|!(?:>?\d+)?|ro?(?:<?\d+)?|>=?\d+|<=?\d+)?/i);
  if (!match) {
    return { count: 0, sides: 0, results: [], kept: [], subtotal: 0 };
  }

  const count = match[1] ? parseInt(match[1], 10) : 1;
  const sides = parseInt(match[2], 10);
  const modifier = match[3] || undefined;

  // Roll all dice
  let results: number[] = [];
  for (let i = 0; i < count; i++) {
    let roll = rollDie(sides);

    // Exploding dice
    if (modifier?.startsWith("!")) {
      const threshold = modifier.length > 1
        ? parseInt(modifier.replace(/[!>]/g, ""), 10)
        : sides;
      let totalRoll = roll;
      while (roll >= threshold) {
        roll = rollDie(sides);
        totalRoll += roll;
      }
      results.push(totalRoll);
      continue;
    }

    // Reroll
    if (modifier?.startsWith("r")) {
      const once = !modifier.startsWith("rr");
      const threshold = parseInt(modifier.replace(/[rRoO<]/g, ""), 10) || 1;
      if (once) {
        if (roll <= threshold) {
          roll = rollDie(sides);
        }
      } else {
        while (roll <= threshold) {
          roll = rollDie(sides);
        }
      }
    }

    results.push(roll);
  }

  // Apply keep/drop modifiers
  let kept = [...results];

  if (modifier) {
    const keepMatch = modifier.match(/^(kh|kl|dh|dl)(\d+)/i);
    if (keepMatch) {
      const mode = keepMatch[1].toLowerCase();
      const n = parseInt(keepMatch[2], 10);

      const sorted = [...results].sort((a, b) => a - b);

      switch (mode) {
        case "kh": // Keep highest N
          kept = sorted.slice(-n);
          break;
        case "kl": // Keep lowest N
          kept = sorted.slice(0, n);
          break;
        case "dh": // Drop highest N
          kept = sorted.slice(0, -n);
          break;
        case "dl": // Drop lowest N
          kept = sorted.slice(n);
          break;
      }
    }

    // Count successes (>=N or >N)
    const successMatch = modifier.match(/^(>=?)(\d+)/);
    if (successMatch) {
      const op = successMatch[1];
      const threshold = parseInt(successMatch[2], 10);
      const successes = results.filter((r) =>
        op === ">=" ? r >= threshold : r > threshold
      ).length;
      return {
        count,
        sides,
        results,
        kept: results,
        modifier,
        subtotal: successes,
      };
    }
  }

  const subtotal = kept.reduce((sum, r) => sum + r, 0);

  return {
    count,
    sides,
    results,
    kept,
    modifier,
    subtotal,
  };
}

// Evaluate expression with tokens
function evaluate(
  tokens: Token[],
  variables: Record<string, number>
): { total: number; rolls: IndividualRoll[] } {
  const rolls: IndividualRoll[] = [];
  let pos = 0;

  function peek(): Token | undefined {
    return tokens[pos];
  }

  function consume(): Token {
    return tokens[pos++];
  }

  function parsePrimary(): number {
    const token = peek();
    if (!token) return 0;

    if (token.type === "lparen") {
      consume(); // (
      const val = parseExpression();
      if (peek()?.type === "rparen") consume(); // )
      return val;
    }

    if (token.type === "dice") {
      consume();
      const roll = processDice(token.value);
      rolls.push(roll);
      return roll.subtotal;
    }

    if (token.type === "number") {
      consume();
      return parseInt(token.value, 10);
    }

    if (token.type === "variable") {
      consume();
      return variables[token.value] ?? 0;
    }

    // Handle unary minus
    if (token.type === "op" && token.value === "-") {
      consume();
      return -parsePrimary();
    }

    // Handle unary plus
    if (token.type === "op" && token.value === "+") {
      consume();
      return parsePrimary();
    }

    return 0;
  }

  function parseTerm(): number {
    let left = parsePrimary();

    while (peek()?.type === "op" && (peek()!.value === "*" || peek()!.value === "/")) {
      const op = consume().value;
      const right = parsePrimary();
      if (op === "*") left *= right;
      else if (op === "/" && right !== 0) left = Math.floor(left / right);
    }

    return left;
  }

  function parseExpression(): number {
    let left = parseTerm();

    while (peek()?.type === "op" && (peek()!.value === "+" || peek()!.value === "-")) {
      const op = consume().value;
      const right = parseTerm();
      if (op === "+") left += right;
      else left -= right;
    }

    return left;
  }

  const total = parseExpression();
  return { total, rolls };
}

/**
 * Roll dice from an expression string.
 *
 * @param expression - Dice expression (e.g., "2d6+3", "4d6kh3", "d20+@strength")
 * @param variables - Variable values for @substitution
 * @returns DiceRoll result
 */
export function roll(
  expression: string,
  variables: Record<string, number> = {}
): DiceRoll {
  const tokens = tokenize(expression);
  const { total, rolls } = evaluate(tokens, variables);

  // Format details string
  const details = formatRollDetails(rolls, expression, variables, total);

  // Check for natural 20/1 on d20 rolls
  let critical: DiceRoll["critical"];
  if (rolls.length === 1 && rolls[0].sides === 20 && rolls[0].count === 1) {
    const result = rolls[0].results[0];
    if (result === 20) critical = "success";
    else if (result === 1) critical = "failure";
  }

  return {
    expression,
    rolls,
    total,
    details,
    critical,
  };
}

function formatRollDetails(
  rolls: IndividualRoll[],
  expression: string,
  variables: Record<string, number>,
  total: number
): string {
  if (rolls.length === 0) {
    return `${expression} = **${total}**`;
  }

  const parts: string[] = [];

  for (const r of rolls) {
    if (r.count === 0) continue;

    const diceExpr = `${r.count > 1 ? r.count : ""}d${r.sides}${r.modifier ?? ""}`;

    if (r.results.length === 1) {
      parts.push(`${diceExpr} [${r.results[0]}]`);
    } else {
      // Show kept vs dropped
      if (r.modifier?.match(/^(kh|kl|dh|dl)/i)) {
        const keptSet = new Set<number>();
        const keptCopy = [...r.kept];
        const formatted = r.results.map((v) => {
          const idx = keptCopy.indexOf(v);
          if (idx >= 0) {
            keptCopy.splice(idx, 1);
            keptSet.add(v);
            return `**${v}**`;
          }
          return `~~${v}~~`;
        });
        parts.push(`${diceExpr} [${formatted.join(", ")}]`);
      } else {
        parts.push(`${diceExpr} [${r.results.join(", ")}]`);
      }
    }
  }

  // Add variable values
  const varEntries = Object.entries(variables).filter(([k]) =>
    expression.includes(`@${k}`)
  );
  for (const [k, v] of varEntries) {
    parts.push(`@${k}=${v}`);
  }

  return `${parts.join(" + ")} = **${total}**`;
}

/**
 * Parse a roll expression and substitute character attributes.
 *
 * @param expression - Expression possibly containing @attribute references
 * @param characterId - Character whose attributes to use
 * @param sceneId - Scene for character state lookup
 */
export function rollWithAttributes(
  expression: string,
  characterId: number,
  sceneId: number | null
): DiceRoll {
  const attrs = getComputedAttributes(characterId, sceneId);

  // Convert attribute names to lowercase for matching
  const variables: Record<string, number> = {};
  for (const [key, value] of Object.entries(attrs)) {
    variables[key.toLowerCase()] = typeof value === "number" ? value : 0;
  }

  return roll(expression, variables);
}

/**
 * Format a dice roll for Discord display.
 */
export function formatRollForDisplay(result: DiceRoll, label?: string): string {
  const lines: string[] = [];

  if (label) {
    lines.push(`**${label}**`);
  }

  lines.push(`\`${result.expression}\` → ${result.details}`);

  if (result.critical === "success") {
    lines.push("**NATURAL 20! Critical Success!**");
  } else if (result.critical === "failure") {
    lines.push("**Natural 1. Critical Failure.**");
  }

  return lines.join("\n");
}

/**
 * Roll multiple dice and return all results.
 * Useful for batch rolling (e.g., ability score generation).
 */
export function rollMultiple(
  expression: string,
  count: number,
  variables: Record<string, number> = {}
): DiceRoll[] {
  const results: DiceRoll[] = [];
  for (let i = 0; i < count; i++) {
    results.push(roll(expression, variables));
  }
  return results;
}

/**
 * Validate a dice expression without rolling.
 */
export function validateExpression(expression: string): {
  valid: boolean;
  error?: string;
} {
  try {
    const tokens = tokenize(expression);
    if (tokens.length === 0) {
      return { valid: false, error: "Empty expression" };
    }

    // Check for at least one dice or number
    const hasDiceOrNumber = tokens.some(
      (t) => t.type === "dice" || t.type === "number" || t.type === "variable"
    );
    if (!hasDiceOrNumber) {
      return { valid: false, error: "No dice or numbers in expression" };
    }

    // Check balanced parentheses
    let depth = 0;
    for (const token of tokens) {
      if (token.type === "lparen") depth++;
      if (token.type === "rparen") depth--;
      if (depth < 0) return { valid: false, error: "Unbalanced parentheses" };
    }
    if (depth !== 0) return { valid: false, error: "Unbalanced parentheses" };

    // Check dice sides are reasonable
    for (const token of tokens) {
      if (token.type === "dice") {
        const match = token.value.match(/^(\d*)d(\d+)/i);
        if (match) {
          const count = match[1] ? parseInt(match[1], 10) : 1;
          const sides = parseInt(match[2], 10);
          if (count > 100) return { valid: false, error: "Too many dice (max 100)" };
          if (sides > 1000) return { valid: false, error: "Too many sides (max 1000)" };
          if (sides < 1) return { valid: false, error: "Dice must have at least 1 side" };
        }
      }
    }

    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid expression" };
  }
}
