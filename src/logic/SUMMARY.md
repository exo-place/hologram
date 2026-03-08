# src/logic/

Pure logic layer with no database or Discord dependencies. Contains the `$if` expression evaluator and a ReDoS-safe regex validator used to sandbox entity-authored patterns.

## Key Files

- `expr.ts` — The core fact evaluation engine.
  - `createBaseContext()` builds the `ExprContext` passed to both `$if` expressions and Nunjucks templates (channel/guild/user IDs, timing values, `self.*` parsed facts, `has_fact()`, `random()`, `roll()`, `time`, `is_hologram`, etc.). Adding a variable here makes it available everywhere automatically.
  - `evaluateFacts()` processes a raw fact list through `parseFact()` → `$if` evaluation → directive extraction (`$respond`, `$model`, `$stream`, `$avatar`, `$memory`, `$context`, `$thinking`, `$collapse`, `$safety`, `$locked`, `$strip`, `$freeform`). Returns `EvaluatedFacts` with the clean fact list and resolved directive values.
  - `parseFact()` classifies a single raw fact line (plain, conditional, directive).
  - `evalExpr()` runs a boolean JavaScript expression in a restricted sandbox (blocked `Function`, `eval`, `process`, prototype access).
  - `compileContextExpr()` compiles a `$context` expression (e.g. `chars < 16000`) into a predicate applied to message history filtering.
  - `parsePermissionDirectives()`, `isUserAllowed()`, `isUserBlacklisted()`, `matchesUserEntry()` — permission checking helpers shared by commands and client.
  - Exports all directive types: `ThinkingLevel`, `CollapseRoles`, `ContentFilter`, `SafetyCategory`, `SafetyThreshold`, `MemoryScope`, `EvaluatedFacts`, `ExprContext`.

- `safe-regex.ts` — `validateRegexPattern()`: a single-pass recursive descent parser that rejects ReDoS-dangerous patterns before they reach `RegExp`. Key invariant: no quantifier may be applied to a sub-expression that itself contains a quantifier. Used by `expr.ts` to validate patterns in `has_fact()` calls authored by entity owners.

## Notes

- The sandbox in `evalExpr()` is a `new Function()` call with a frozen globals object. Prototype chain access and dangerous globals (`process`, `require`, `eval`) are explicitly blocked.
- `$if` expressions and Nunjucks templates share the same base variable set via `ExprContext` — template-only additions (entities, history, memories) are layered on top in `src/ai/template.ts`.
