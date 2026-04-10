# web/src/

SolidJS application source. Uses SolidJS signals and `@solidjs/router` for reactivity and routing.

`index.tsx` — Entry point: renders `<App />` into `#app`.

`App.tsx` — Root component: sidebar navigation, lazy-loaded route definitions for all views.

`style.css` — BEM design system with CSS custom properties. Dark theme by default. Component styles live in co-located `.css` files.

## Subdirectories

- `api/` — Typed fetch client (`client.ts`) and SSE subscription helper (`sse.ts`). Imports shared request/response types from the backend via the `@api` alias.
- `views/` — Full-page route components: `EntityList`, `EntityDetail`, `Chat`, `Debug`.
- `components/` — Reusable UI components: `FactEditor`, `ConfigEditor`, `TemplateEditor`, `MemoriesPanel`, `ChatMessage`, `MonacoEditor`.
- `monaco/` — Monaco editor integration: Monarch tokenizers for `.holo` (hologram facts) and Nunjucks templates, theme registration (`hologram-dark`, `hologram-light`).
