## src/api/routes/

Route handler modules for the Bun.serve() REST API. Each module exports a `RouteHandler` function that receives `(req, url)` and returns a `Response` or `null` (pass-through to next handler).

- **entities.ts** — Entity CRUD: list/create/get/rename/delete, fact CRUD, config get/patch, template get/set, system-template get/set, memories list/add/delete.
- **chat.ts** — Web channel management and messaging. Routes: create/list/delete/patch channels, message history, send message (stores + triggers AI response), SSE stream, `POST .../forget` (sets a forget timestamp so AI context excludes earlier messages), `POST .../trigger` (fires entity responses without a user message). Exports `sseClients` map and `broadcastSSE()` for use by other modules.
- **discord-channels.ts** — Read-only browse routes for Discord channels that have entity bindings. Routes: list Discord channels with their bound entities and latest message (`GET /api/discord-channels`), message history (`GET /api/discord-channels/:id/messages`), and SSE stream (`GET /api/discord-channels/:id/stream`). Shares the `sseClients` map from `chat.ts` so the Discord bot's broadcasts reach web viewers.
- **debug.ts** — Debug inspection routes (all GET): binding graph, eval errors, embedding coverage, embedding model status, per-entity fact evaluation trace, and response simulation for a channel.
