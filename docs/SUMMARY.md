# docs/ — Summary

VitePress documentation site for Hologram. Covers user-facing concepts, guides, and reference material.

## Key Files

- `index.md` — Landing page
- `philosophy.md` — Design philosophy and principles
- `README.md` — (legacy user readme, partially superseded by site)

## Subdirectories

- `guide/` — Step-by-step guides: channel setup, personas, permissions, multi-character, transformations, editor setup, SillyTavern migration
- `reference/` — API-style reference: facts syntax, directives, triggers, templates, commands, expression security, safe-regex
- `playground/` — Interactive fact and template evaluators (Vue + Monaco, browser-side Nunjucks)
- `design/` — Internal design docs (not user-facing)
- `archive/` — Old docs from previous architecture iterations
- `.vitepress/` — VitePress config, custom theme, playground shims and components

## Dev

```
bun run dev   # from docs/ — starts VitePress dev server
```
