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

- **`entities.ts`** — Entity CRUD: list/create/get/update/delete, facts CRUD, config, templates, memories; `POST /api/entities/:id/trigger` fires entity response in a web channel
- **`chat.ts`** — Web channel management, message history, send message (triggers AI via chat-adapter), SSE stream endpoint; exports `broadcastSSE()` and `sseClients`. `POST /api/channels/:id/forget` also available.
- **`discord-channels.ts`** — Read-only Discord channel browse: list bound channels with entity names, message history, SSE stream (shared `sseClients` map with chat.ts so bot broadcasts reach web clients)
- **`debug.ts`** — Debug inspection: bindings, eval errors, embedding status/coverage, fact trace, response simulation
- **`auth.ts`** — Discord OAuth 2.0: `/api/auth/discord/login`, `/api/auth/discord/callback`, `/api/auth/me`, `/api/auth/logout`. Uses `web_sessions` table. Requires `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`.
- **`moderation.ts`** — Mute CRUD (auth-gated): `GET/POST /api/mutes`, `DELETE /api/mutes/:id`, `POST /api/mutes/bulk-clear`.
- **`audit.ts`** — Mod event log (auth-gated): `GET /api/audit` with filters.
- **`server-config.ts`** — Guild/channel rate and chain config (auth-gated): `GET/PATCH /api/guilds/:guildId/config`, `GET/PATCH /api/channels/:channelId/config`.

## Key Routes

```
GET         /api/auth/discord/login
GET         /api/auth/discord/callback
GET         /api/auth/me
POST        /api/auth/logout

GET/POST    /api/entities
GET/PUT/DELETE  /api/entities/:id
GET/POST    /api/entities/:id/facts
PUT/DELETE  /api/entities/:id/facts/:fid
GET/PATCH   /api/entities/:id/config
GET/PUT     /api/entities/:id/template
GET/PUT     /api/entities/:id/system-template
GET/POST    /api/entities/:id/memories
DELETE      /api/entities/:id/memories/:mid
POST        /api/entities/:id/trigger

POST/GET    /api/channels
PATCH/DELETE /api/channels/:id
GET/POST    /api/channels/:id/messages
POST        /api/channels/:id/forget
GET         /api/channels/:id/stream     (SSE)

GET         /api/discord-channels
GET         /api/discord-channels/:id/messages
GET         /api/discord-channels/:id/stream    (SSE, read-only)

GET/POST    /api/mutes                   (auth required)
DELETE      /api/mutes/:id              (auth required)
POST        /api/mutes/bulk-clear        (auth required)
GET         /api/audit                   (auth required)
GET/PATCH   /api/guilds/:id/config       (auth required)
GET/PATCH   /api/channels/:id/config     (auth required)

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
- `DISCORD_CLIENT_ID` — Discord OAuth app client ID (for web login)
- `DISCORD_CLIENT_SECRET` — Discord OAuth app client secret
- `DISCORD_REDIRECT_URI` — OAuth callback URL (must match Discord app settings)
- `COOKIE_SECRET` — Session cookie signing secret (default: dev placeholder)
