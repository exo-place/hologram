# web/

SolidJS single-page application — the browser frontend for Hologram. Built with Vite + vite-plugin-solid, served by the Bun API server from `web/dist/` after `bun run build`.

`index.html` — Entry HTML shell. Loads `src/index.tsx`.

`vite.config.ts` — Vite config: SolidJS plugin, Monaco editor plugin, `@api` path alias (resolves to `src/api/` in the backend for shared types), dev proxy to forward `/api/` to `localhost:3000`.

`package.json` — Frontend dependencies only (SolidJS, Monaco, Vite).

`tsconfig.json` — TypeScript config for the frontend (JSX transform: solid).

## Subdirectories

- `src/` — Application source: router, views, components, API client, Monaco integration
- `public/` — Static assets served at root (favicon, icons)
- `dist/` — Build output (gitignored), served by the API server
