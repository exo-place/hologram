# src/api/

REST API server for the web frontend.

Started when `WEB !== "false"` (default: on). Runs in the same process as the Discord bot when both are enabled.

## Files

- **`index.ts`** — `Bun.serve()` entry point, CORS middleware, route dispatch, static file serving for `web/dist/`
- **`helpers.ts`** — Shared utilities: `ok()`, `err()`, `parseId()`, `parseBody()`, and the `RouteHandler` type
- **`types.ts`** — Shared TypeScript types for API requests and responses (imported by both server and frontend via Vite alias)
- **`chat-adapter.ts`** — Bridges web channel messages to the AI pipeline: entity fact evaluation, memory retrieval, streaming via SSE
- **`api.test.ts`** — Route tests using in-memory DB + mock embeddings

## routes/

- **`entities.ts`** — Entity CRUD: list/create/get/update/delete, facts CRUD, config, templates, memories
- **`chat.ts`** — Web channel management, message history, send message (triggers AI via chat-adapter), SSE stream endpoint; exports `broadcastSSE()`
- **`debug.ts`** — Debug inspection: bindings, eval errors, embedding status/coverage, fact trace, response simulation

## Key Routes

```
GET/POST    /api/entities
GET/PUT/DELETE  /api/entities/:id
GET/POST    /api/entities/:id/facts
PUT/DELETE  /api/entities/:id/facts/:fid
GET/PATCH   /api/entities/:id/config
GET/PUT     /api/entities/:id/template
GET/PUT     /api/entities/:id/system-template
GET/POST    /api/entities/:id/memories
DELETE      /api/entities/:id/memories/:mid

POST/GET    /api/channels
PATCH/DELETE /api/channels/:id
GET/POST    /api/channels/:id/messages
GET         /api/channels/:id/stream     (SSE)

GET         /api/debug/bindings
GET         /api/debug/errors
GET         /api/debug/embedding-status
GET         /api/debug/embeddings        (?entity= required)
GET         /api/debug/trace/:entityId
GET         /api/debug/simulate/:channelId
```

## Environment Variables

- `WEB=false` — disable web server
- `WEB_PORT=3000` — port (default 3000)
