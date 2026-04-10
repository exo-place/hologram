# src/

Root source directory for Hologram. Contains the entry point, the structured logger, and subdirectories for each major subsystem.

`index.ts` initialises the database, starts the Discord bot, and registers SIGINT/SIGTERM handlers for graceful shutdown. It is the sole entry point — `bun run start` runs this file directly.

`logger.ts` provides the project-wide structured logger (`debug`, `info`, `warn`, `error`, `child`). Supports JSON mode (production) and pretty-printed TTY mode (dev). Binary typed-array values are automatically redacted in log context to avoid flooding logs with raw bytes. **Never use `console.log` directly** — always import from this module.

`njk.d.ts` provides TypeScript ambient declarations for importing `.njk` Nunjucks template files as strings via `with { type: "text" }`.

## Subdirectories

- `ai/` — LLM integration: prompt building, streaming, tools, template engine, attachment handling
- `api/` — Bun.serve() REST API server, SSE streaming, chat adapter, debug routes
- `bot/` — Discordeno client, slash commands, webhook delivery
- `db/` — SQLite schema, entity/fact CRUD, Discord ID mappings, memories, effects, attachment cache
- `debug/` — Inspection utilities shared by CLI debug tool and Discord `/debug` commands
- `logic/` — `$if` expression evaluator and ReDoS-safe regex validator
- `templates/` — Nunjucks `.njk` template source files (default, simple, sillytavern presets)
