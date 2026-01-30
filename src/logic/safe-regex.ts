/**
 * Safe regex pattern validator for expression evaluator.
 *
 * JS string methods .match(), .search(), .replace(), .split() compile their
 * string argument into a RegExp. Entity authors control the pattern via $if
 * expressions, so catastrophic backtracking patterns like (a+)+b can hang
 * the event loop.
 *
 * This module provides compile-time validation: a single-pass recursive descent
 * parser that structurally rejects dangerous constructs. The key safety invariant
 * is **no quantifier may be applied to an expression that itself contains a
 * quantifier** — this prevents all catastrophic backtracking.
 */

import { ExprError } from "./expr";

// =============================================================================
// AST Types
// =============================================================================

interface RegexNode {
  /** Whether this node or any descendant contains a quantifier */
  hasQuantifier: boolean;
  /** Whether this node is an anchor (zero-width, not quantifiable) */
  isAnchor?: boolean;
}

// =============================================================================
// Allowed Escapes
// =============================================================================

/** Shorthand character classes and special escapes */
const SHORTHAND_ESCAPES = new Set([
  "d", "D", "w", "W", "s", "S", "t", "n", "r", "b",
]);

/** Escaped special characters (literal meaning) */
const SPECIAL_ESCAPES = new Set([
  ".", "\\", "[", "]", "(", ")", "{", "}", "+", "*", "?", "^", "$", "|", "-", "/",
]);

// =============================================================================
// Parser
// =============================================================================

/**
 * Validate a regex pattern string for safety.
 * Throws ExprError with a descriptive message if the pattern is unsafe.
 */
export function validateRegexPattern(pattern: string): void {
  const parser = new RegexParser(pattern);
  parser.parse();
}

class RegexParser {
  private pattern: string;
  private pos = 0;

  constructor(pattern: string) {
    this.pattern = pattern;
  }

  private peek(): string | undefined {
    return this.pattern[this.pos];
  }

  private advance(): string {
    return this.pattern[this.pos++];
  }

  private hasMore(): boolean {
    return this.pos < this.pattern.length;
  }

  /** Entry point: parse the full pattern */
  parse(): void {
    this.parseAlternation();
    if (this.hasMore()) {
      const ch = this.peek()!;
      if (ch === ")") {
        throw new ExprError('Unsafe regex: unexpected ")" without matching "("');
      }
      throw new ExprError(`Unsafe regex: unexpected character "${ch}"`);
    }
  }

  /** Parse alternation: a|b|c */
  private parseAlternation(): RegexNode {
    let node = this.parseSequence();
    while (this.peek() === "|") {
      this.advance(); // |
      const right = this.parseSequence();
      // Alternation propagates hasQuantifier from either branch
      node = { hasQuantifier: node.hasQuantifier || right.hasQuantifier };
    }
    return node;
  }

  /** Parse a sequence of atoms with optional quantifiers */
  private parseSequence(): RegexNode {
    let hasQuantifier = false;

    while (this.hasMore()) {
      const ch = this.peek()!;
      // Stop at alternation or group close
      if (ch === "|" || ch === ")") break;

      const atom = this.parseAtom();
      if (!atom) break;

      // Try to parse a quantifier after the atom
      const quantified = this.tryQuantifier(atom);
      if (quantified.hasQuantifier) {
        hasQuantifier = true;
      }
    }

    return { hasQuantifier };
  }

  /** Parse a single atom: literal, escape, class, group, dot, anchor */
  private parseAtom(): RegexNode | null {
    if (!this.hasMore()) return null;

    const ch = this.peek()!;

    switch (ch) {
      case "\\":
        return this.parseEscape();
      case "[":
        return this.parseCharacterClass();
      case "(":
        return this.parseGroup();
      case ".":
        this.advance();
        return { hasQuantifier: false };
      case "^":
      case "$":
        this.advance();
        return { hasQuantifier: false, isAnchor: true };
      case ")":
      case "|":
        return null;
      case "*":
      case "+":
      case "?":
      case "{":
        // Quantifier without atom — treat { as literal if not valid quantifier syntax
        if (ch === "{") {
          // Check if this is a valid quantifier: {n}, {n,}, {n,m}
          if (this.isQuantifierBrace()) {
            throw new ExprError('Unsafe regex: quantifier without preceding element');
          }
          // Not a valid quantifier — treat as literal
          this.advance();
          return { hasQuantifier: false };
        }
        throw new ExprError('Unsafe regex: quantifier without preceding element');
      default:
        this.advance();
        return { hasQuantifier: false };
    }
  }

  /** Parse a backslash escape */
  private parseEscape(): RegexNode {
    this.advance(); // consume '\'
    if (!this.hasMore()) {
      throw new ExprError("Unsafe regex: trailing backslash with nothing after it");
    }

    const ch = this.advance();

    if (SHORTHAND_ESCAPES.has(ch)) {
      // \b is a word boundary (zero-width anchor)
      if (ch === "b") {
        return { hasQuantifier: false, isAnchor: true };
      }
      return { hasQuantifier: false };
    }

    if (SPECIAL_ESCAPES.has(ch)) {
      return { hasQuantifier: false };
    }

    // Backreferences: \1 through \9
    if (ch >= "1" && ch <= "9") {
      throw new ExprError(
        `Unsafe regex: backreferences (\\${ch}) are not allowed — they can cause exponential matching time`
      );
    }

    throw new ExprError(
      `Unsafe regex: unknown escape "\\${ch}". Allowed: \\d \\w \\s \\D \\W \\S \\t \\n \\r \\b and escaped special characters`
    );
  }

  /** Parse a character class: [abc], [^a-z], [\w\d] */
  private parseCharacterClass(): RegexNode {
    this.advance(); // consume '['

    // Optional negation
    if (this.peek() === "^") {
      this.advance();
    }

    // Allow ] as first character in class (literal)
    if (this.peek() === "]") {
      this.advance();
    }

    while (this.hasMore()) {
      const ch = this.peek()!;
      if (ch === "]") {
        this.advance();
        return { hasQuantifier: false };
      }
      if (ch === "\\") {
        this.parseClassEscape();
      } else {
        this.advance();
      }
    }

    throw new ExprError('Unsafe regex: unterminated character class — missing closing "]"');
  }

  /** Parse an escape inside a character class */
  private parseClassEscape(): void {
    this.advance(); // consume '\'
    if (!this.hasMore()) {
      throw new ExprError("Unsafe regex: trailing backslash with nothing after it");
    }

    const ch = this.advance();

    if (SHORTHAND_ESCAPES.has(ch) || SPECIAL_ESCAPES.has(ch)) {
      return;
    }

    // Backreferences inside classes
    if (ch >= "1" && ch <= "9") {
      throw new ExprError(
        `Unsafe regex: backreferences (\\${ch}) are not allowed — they can cause exponential matching time`
      );
    }

    throw new ExprError(
      `Unsafe regex: unknown escape "\\${ch}". Allowed: \\d \\w \\s \\D \\W \\S \\t \\n \\r \\b and escaped special characters`
    );
  }

  /** Parse a group: (?:...) or reject capturing/special groups */
  private parseGroup(): RegexNode {
    this.advance(); // consume '('

    if (!this.hasMore()) {
      throw new ExprError('Unsafe regex: unterminated group — missing closing ")"');
    }

    const ch = this.peek()!;

    if (ch === "?") {
      this.advance(); // consume '?'
      if (!this.hasMore()) {
        throw new ExprError('Unsafe regex: unterminated group — missing closing ")"');
      }

      const next = this.peek()!;

      if (next === ":") {
        // Non-capturing group (?:...)
        this.advance(); // consume ':'
        const inner = this.parseAlternation();

        if (!this.hasMore() || this.peek() !== ")") {
          throw new ExprError('Unsafe regex: unterminated group — missing closing ")"');
        }
        this.advance(); // consume ')'

        return { hasQuantifier: inner.hasQuantifier };
      }

      if (next === "=") {
        throw new ExprError("Unsafe regex: lookahead (?=...) is not allowed");
      }

      if (next === "!") {
        throw new ExprError("Unsafe regex: negative lookahead (?!...) is not allowed");
      }

      if (next === "<") {
        this.advance(); // consume '<'
        if (!this.hasMore()) {
          throw new ExprError('Unsafe regex: unterminated group — missing closing ")"');
        }
        const after = this.peek()!;
        if (after === "=") {
          throw new ExprError("Unsafe regex: lookbehind (?<=...) is not allowed");
        }
        if (after === "!") {
          throw new ExprError("Unsafe regex: negative lookbehind (?<!...) is not allowed");
        }
        throw new ExprError("Unsafe regex: named groups are not allowed. Use (?:...) instead");
      }

      throw new ExprError(`Unsafe regex: unknown group type "(?${next}...)"`);
    }

    // Plain capturing group (abc) — reject
    throw new ExprError(
      'Unsafe regex: capturing groups are not allowed (causes backtracking). Use (?:abc) instead'
    );
  }

  /** Try to parse a quantifier after an atom. Enforces safety invariant. */
  private tryQuantifier(atom: RegexNode): RegexNode {
    if (!this.hasMore()) return atom;

    const ch = this.peek()!;
    let isQuantifier = false;

    if (ch === "*" || ch === "+" || ch === "?") {
      isQuantifier = true;
    } else if (ch === "{" && this.isQuantifierBrace()) {
      isQuantifier = true;
    }

    if (!isQuantifier) return atom;

    // Check anchor quantification
    if (atom.isAnchor) {
      throw new ExprError(
        "Unsafe regex: quantifier on an anchor (^ $ \\b) — anchors are zero-width and cannot be quantified"
      );
    }

    // Safety invariant: no quantifier on an expression that already has a quantifier
    if (atom.hasQuantifier) {
      const qChar = this.peek()!;
      const quantStr = qChar === "{" ? this.peekQuantifierBrace() : qChar;
      throw new ExprError(
        `Unsafe regex: nested quantifier "${quantStr}" on a group that already contains a quantifier — ` +
        "this causes catastrophic backtracking. Flatten the pattern or remove one quantifier"
      );
    }

    // Consume the quantifier
    this.consumeQuantifier();

    return { hasQuantifier: true };
  }

  /** Check if current position starts a valid {n}, {n,}, or {n,m} quantifier */
  private isQuantifierBrace(): boolean {
    let i = this.pos + 1; // skip past '{'
    // Must start with a digit
    if (i >= this.pattern.length || !/\d/.test(this.pattern[i])) return false;
    // Read digits
    while (i < this.pattern.length && /\d/.test(this.pattern[i])) i++;
    if (i >= this.pattern.length) return false;
    // {n}
    if (this.pattern[i] === "}") return true;
    // {n,
    if (this.pattern[i] === ",") {
      i++;
      if (i >= this.pattern.length) return false;
      // {n,}
      if (this.pattern[i] === "}") return true;
      // {n,m}
      if (!/\d/.test(this.pattern[i])) return false;
      while (i < this.pattern.length && /\d/.test(this.pattern[i])) i++;
      if (i < this.pattern.length && this.pattern[i] === "}") return true;
    }
    return false;
  }

  /** Peek at the full quantifier brace for error messages */
  private peekQuantifierBrace(): string {
    let i = this.pos;
    while (i < this.pattern.length && this.pattern[i] !== "}") i++;
    return this.pattern.slice(this.pos, i + 1);
  }

  /** Consume a quantifier: *, +, ?, {n}, {n,}, {n,m}, plus optional lazy ? */
  private consumeQuantifier(): void {
    const ch = this.advance();

    if (ch === "{") {
      // Consume until }
      while (this.hasMore() && this.peek() !== "}") {
        this.advance();
      }
      if (this.hasMore()) {
        this.advance(); // consume '}'
      }
    }

    // Optional lazy modifier
    if (this.peek() === "?") {
      this.advance();
    }
  }
}
