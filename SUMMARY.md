# Hologram — Project Summary

Discord bot for collaborative worldbuilding and roleplay. Built on an entity-facts model: every character, location, and item is an **entity** with freeform **facts**. Facts drive LLM system prompts; conditional facts (`$if`) and directives (`$respond`, `$model`, `$thinking`, etc.) control behavior dynamically.

## Key Directories

- `src/` — All runtime source (TypeScript, Bun)
  - `src/ai/` — LLM pipeline: prompt building, streaming, templates, tools, models
  - `src/bot/` — Discord client (Discordeno) + 7 slash commands
  - `src/db/` — SQLite schema (9 tables), entity/fact CRUD, message history
  - `src/logic/` — `$if` expression evaluator, safe-regex validator
  - `src/debug/` — DB state inspection and fact evaluation tracing
- `docs/` — VitePress documentation site (user-facing)
- `scripts/` — CLI debug tool and benchmarks
- `editors/vscode/` — VS Code syntax highlighting for `.holo` / `.njk`
- `test/` — Test setup and coverage metadata

## Stack

Bun · bun:sqlite · Discordeno · AI SDK v6 · Nunjucks · oxlint · tsgo

## Entry Points

- `src/index.ts` — bot startup
- `src/bot/client.ts` — Discord message handling
- `src/bot/commands/commands.ts` — slash command definitions
- `src/ai/handler.ts` — `handleMessage()` (core message pipeline)
