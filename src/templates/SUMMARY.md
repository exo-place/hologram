# src/templates/

Nunjucks (`.njk`) template source files. These are the built-in system prompt layout presets an entity can select via `/edit <entity> type:config`. They are imported as raw text strings via `with { type: "text" }` and processed by `src/ai/template.ts`.

## Files

- `default.njk` — The standard Hologram template. Renders entity definitions in `<defs>` XML blocks, injects retrieved memories in `<memories>` blocks, formats multi-entity response instructions, then emits message history. History embeds are rendered as text summaries (title/description/fields) with images attached via `attach()` — raw JSON is intentionally not dumped to prevent LLM echo corruption. All output is system-role by default (no explicit `send_as` calls in the definitions block; history messages use `send_as` to assign user/assistant roles based on the `responders` map).
- `sillytavern.njk` — A two-character-focused layout styled after SillyTavern's prompt format. Uses an explicit system-role preamble via `{% call send_as("system") %}`, separate `{% block %}` sections for `char`, `user`, and world info entities, followed by message history.
- `simple.njk` — A minimal single-character template without `send_as` calls. The entire output is treated as one system message. Suitable for providers or use cases where the two-layer system / user message split is unwanted.

## Notes

- Templates have access to all `ExprContext` variables plus template-specific additions: `entities`, `others`, `memories`, `history`, `char`, `user`, `responders` (see `src/ai/template.ts`).
- The `send_as(role)` macro is injected automatically at render time — templates do not need to import it.
- Custom templates (per-entity, stored in the `entities.template` column) can `{% extends "sillytavern" %}` or any other entity name to inherit from these presets.
