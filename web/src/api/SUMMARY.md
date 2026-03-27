## web/src/api/

Typed client layer for communicating with the Hologram REST API and SSE streams.

- **client.ts** — Typed fetch wrapper. All methods return the unwrapped `data` field on success or throw an `Error` with the server's message on failure. Re-exports shared API types from `@api/types`. Namespaces:
  - `entities` — CRUD for entities, facts, config (patch), templates, memories.
  - `channels` — Web channel management (list, create, update, delete), message history, send message, `forget` (exclude history from context), and `trigger` (fire entity responses without a user message).
  - `debug` — Binding graph, eval errors, embedding status/coverage, fact trace, and response simulation.
- **sse.ts** — SSE subscription helper. `subscribeSSE(channelId, onEvent, onError?)` opens an `EventSource` to `/api/channels/:id/stream` and returns an `{ close() }` handle. Used by the Chat view for real-time typing indicators and streaming message tokens.
