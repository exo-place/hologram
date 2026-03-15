# src/logic/

Pure logic layer with no database or Discord dependencies. Contains the `$if` expression evaluator and a ReDoS-safe regex validator used to sandbox entity-authored patterns.

## Key Files

- `expr.ts` — Public API and core directive evaluation engine. Re-exports everything from `expr-compiler.ts` and `expr-context.ts` for backward compatibility.
  - `evaluateFacts()` processes a raw fact list through `parseFact()` → `$if` evaluation → directive extraction (`$respond`, `$model`, `$stream`, `$avatar`, `$memory`, `$context`, `$thinking`, `$collapse`, `$safety`, `$locked`, `$strip`, `$freeform`). Returns `EvaluatedFacts` with the clean fact list and resolved directive values.
  - `parseFact()` classifies a single raw fact line (plain, conditional, directive).
  - `parsePermissionDirectives()`, `isUserAllowed()`, `isUserBlacklisted()`, `matchesUserEntry()` — permission checking helpers shared by commands and client.
  - Exports all directive types: `ThinkingLevel`, `CollapseRoles`, `ContentFilter`, `SafetyCategory`, `SafetyThreshold`, `MemoryScope`, `EvaluatedFacts`, `ExprContext`.

- `expr-compiler.ts` — Tokenizer, Parser, code generator, and compiled expression caches.
  - `ExprError` — expression evaluation error class.
  - `compileExpr()` / `evalExpr()` — compile and evaluate boolean `$if` expressions in a restricted sandbox.
  - `compileTemplateExpr()` — compile template expressions (returns raw value, supports extra loop variables).
  - `evalMacroValue()` / `evalRaw()` — evaluate macro `{{expr}}` expansions.
  - `Tokenizer` / `Parser` — exported for use by `parseCondition()` in expr.ts.

- `expr-context.ts` — Context factory and runtime utilities.
  - `createBaseContext()` builds the `ExprContext` passed to both `$if` expressions and Nunjucks templates (channel/guild/user IDs, timing values, `self.*` parsed facts, `has_fact()`, `random()`, `roll()`, `time`, `is_hologram`, etc.). Adding a variable here makes it available everywhere automatically.
  - `parseSelfContext()` — parses `key: value` facts into the `self.*` object.
  - `checkKeywordMatch(keywords, content)` — tests a message against a keyword list (plain substring or `/regex/flags`). Used for trigger keyword config.
  - `rollDice()`, `formatDuration()`, `parseOffset()` — runtime utility functions used in `createBaseContext()`.

- `safe-regex.ts` — `validateRegexPattern()`: a single-pass recursive descent parser that rejects ReDoS-dangerous patterns before they reach `RegExp`. Key invariant: no quantifier may be applied to a sub-expression that itself contains a quantifier. Used by `expr-compiler.ts` to validate patterns in `has_fact()` and `checkKeywordMatch()` calls authored by entity owners.

## Notes

- The sandbox in `evalExpr()` is a `new Function()` call with a frozen globals object. Prototype chain access and dangerous globals (`process`, `require`, `eval`) are explicitly blocked.
- `$if` expressions and Nunjucks templates share the same base variable set via `ExprContext` — template-only additions (entities, history, memories) are layered on top in `src/ai/template.ts`.
