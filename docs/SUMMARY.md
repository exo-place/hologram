# docs/

VitePress documentation site for Hologram. Contains user-facing documentation, reference pages, and interactive playgrounds. Built with `bun run build` inside this directory.

## Key Files and Directories

- `index.md` — Home page (VitePress hero layout)
- `philosophy.md` — Design philosophy and core concepts
- `reference/` — Full reference for facts, templates, expressions, tools, configuration, and commands
- `guide/` — Migration guides (e.g. SillyTavern → Hologram)
- `playground/` — Interactive playground pages for facts and templates (powered by browser-compiled TypeScript)
- `design/` — Architecture decision records (`decisions.md`)
- `archive/` — Old docs from previous architecture (kept for reference)
- `.vitepress/` — VitePress config, custom theme, and playground implementation

## Notes

- The playground runs the same fact evaluator and template engine as production, compiled for the browser.
- Vite aliases (`@api`) allow playground code to import shared types from `src/api/types.ts`.
