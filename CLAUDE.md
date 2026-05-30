# Hologram

Discord bot for collaborative worldbuilding and roleplay, built on an entity-facts model.

## Tech Stack

- **Runtime**: Bun (native SQLite, TypeScript-first)
- **Discord**: Discordeno (Bun-native, optional — requires `DISCORD_TOKEN`)
- **Web**: Bun.serve() REST API (optional — on by default, set `WEB=false` to disable)
- **LLM**: AI SDK v6 with provider-agnostic `provider:model` spec (default: `google:gemini-3-flash-preview`)
- **Database**: bun:sqlite (10 tables — shared by Discord bot and web server)
- **Linting**: oxlint
- **Type checking**: tsgo

## Project Structure

```
src/
├── index.ts              # Entry point (conditional: Discord bot if DISCORD_TOKEN, web if WEB!=false)
├── logger.ts             # Logging utilities
├── db/
│   ├── index.ts          # Database setup + schema (10 tables)
│   ├── entities.ts       # Entity/fact CRUD
│   └── discord.ts        # Discord ID mapping + message history
├── ai/
│   ├── models.ts         # Provider abstraction (provider:model spec)
│   ├── context.ts        # EvaluatedEntity, MessageContext, formatting utils
│   ├── handler.ts        # handleMessage() + re-exports
│   ├── parsing.ts        # Response parsing (Name prefix), name stripping
│   ├── prompt.ts         # expandEntityRefs(), buildPromptAndMessages()
│   ├── streaming.ts      # handleMessageStreaming(), stream generators
│   ├── template.ts       # Nunjucks template engine, DEFAULT_TEMPLATE, runtime security patches
│   ├── tools.ts          # createTools() factory + $locked permission checks
│   └── embeddings.ts     # Local embeddings (planned)
├── api/                  # Web API server (Phase 1)
│   ├── index.ts          # Bun.serve() + route dispatch, CORS, static files
│   ├── helpers.ts        # RouteHandler type, ok/err/parseId/parseBody helpers
│   ├── types.ts          # Shared request/response types (imported by frontend)
│   ├── chat-adapter.ts   # Bridges web messages → AI pipeline (evaluateFacts, streaming, SSE)
│   └── routes/
│       ├── entities.ts   # Entity CRUD (GET/POST/PUT/DELETE + facts/config/template/memories)
│       ├── chat.ts       # Web channel management, message history, SSE stream; exports broadcastSSE()
│       └── debug.ts      # Debug inspection (bindings, errors, embeddings, trace, simulate)
├── logic/
│   ├── expr.ts           # $if expression evaluator + $respond control
│   └── safe-regex.ts     # Regex pattern validator (ReDoS prevention)
├── debug/
│   ├── index.ts          # Re-exports all debug functions
│   ├── embeddings.ts     # RAG/embedding debug (status, coverage, retrieval)
│   ├── state.ts          # DB state inspection (bindings, memories, effects, errors, messages)
│   └── evaluation.ts     # Fact evaluation tracing, buildEvaluatedEntity (shared)
└── bot/
    ├── client.ts         # Discordeno setup + message handling
    └── commands/
        ├── index.ts      # Command registry + interaction router
        └── commands.ts   # 7 slash commands

web/                          # SolidJS SPA frontend (Vite + vite-plugin-solid)
├── index.html
├── vite.config.ts            # Vite config: solid plugin, monaco plugin, @api alias, dev proxy
├── tsconfig.json
├── package.json
└── src/
    ├── index.tsx             # Entry: render <App />
    ├── App.tsx               # Router + layout (sidebar nav, lazy-loaded routes)
    ├── style.css             # BEM design system (CSS custom properties, dark theme)
    ├── api/
    │   ├── client.ts         # Typed fetch wrapper (entities, channels, debug namespaces)
    │   └── sse.ts            # SSE client (subscribeSSE → { close() })
    ├── views/
    │   ├── EntityList.tsx/css   # Searchable entity list, create/delete dialogs
    │   ├── EntityDetail.tsx/css # Tabbed entity view (Facts/Config/Template/System Prompt/Memories)
    │   ├── Chat.tsx/css         # Web chat with channel management, SSE streaming
    │   └── Debug.tsx/css        # Debug panel (bindings, eval errors, embeddings, fact trace)
    ├── components/
    │   ├── FactEditor.tsx/css     # Inline fact CRUD
    │   ├── ConfigEditor.tsx/css   # Entity config form (model, stream, memory, thinking…)
    │   ├── TemplateEditor.tsx/css # Monaco-based template editor
    │   ├── MemoriesPanel.tsx/css  # Memory list + add/delete
    │   ├── ChatMessage.tsx/css    # Single message bubble (user vs bot)
    │   └── MonacoEditor.tsx/css   # SolidJS Monaco wrapper (lazy-loaded)
    └── monaco/
        ├── hologram-monarch.ts          # Monarch tokenizer for .holo facts
        ├── hologram-template-monarch.ts # Monarch tokenizer for Nunjucks templates
        └── register.ts                  # Register languages + hologram-dark/light themes

docs/
├── README.md             # User documentation
├── reference/            # Fact patterns, triggers reference
├── guide/                # Migration guides (SillyTavern)
├── playground/           # Interactive playground pages (facts.md, templates.md)
├── .vitepress/
│   ├── config.ts         # VitePress config (sidebar, Vite aliases for playground)
│   ├── theme/            # Custom theme extending default (playground styles)
│   └── playground/       # Playground implementation
│       ├── shims/        # Browser shims (ai-context.ts)
│       ├── languages/    # Monarch tokenizers for Monaco (hologram, hologram-template)
│       ├── presets/      # Preset examples for fact and template playgrounds
│       ├── components/   # Vue components (editors, output, presets)
│       ├── fact-evaluator.ts      # Browser wrapper for evaluateFacts()
│       ├── template-engine.ts     # Browser-compatible Nunjucks renderer
│       └── template-evaluator.ts  # Template context builder for playground
└── archive/              # Old docs from previous architecture

scripts/
└── debug.ts              # CLI debug tool: bun run debug <subcommand>

editors/
└── vscode/               # VS Code extension: .holo + .njk syntax highlighting
    ├── README.md
    ├── package.json
    └── syntaxes/
        ├── hologram.tmLanguage.json
        └── hologram-template.tmLanguage.json
```

## Architecture

For the reasoning behind architectural choices, see `docs/design/decisions.md`.

### Core Model

Everything is an **entity** with **facts**. No distinction between character/location/item - all entities.

```
Entity: Aria
Facts:
  - is a character
  - has silver hair
  - is in {{entity:12}}
  - $if mentioned: $respond
```

**Macros:** `{{entity:ID}}` expands to entity name, `{{char}}` expands to current entity name, `{{user}}` expands to literal "user". Any expression works: `{{channel.name}}`, `{{self.health}}`, etc. See `src/ai/prompt.ts` for macro expansion and `docs/reference/` for the full list.

### Database (10 tables)

```sql
entities         -- id, name, owned_by, created_at, template, system_template
facts            -- id, entity_id, content, created_at, updated_at
discord_entities -- discord_id, discord_type, entity_id, scope_guild_id, scope_channel_id
discord_config   -- discord_id, discord_type, config_bind, config_persona, config_blacklist, config_sendnote (bind/note permissions)
fact_embeddings  -- (planned) vector search
messages         -- channel_id, user_id, author_name, content, discord_message_id, data, created_at
welcomed_users   -- discord_id, welcomed_at (onboarding DM tracking)
webhook_messages -- message_id, entity_id, entity_name (for reply detection)
eval_errors      -- entity_id, owner_id, error_message, condition (deduped error notifications)
web_channels     -- id (web:<uuid>), name, entity_ids (JSON array), created_at
```

### Message Pipeline

```
Discord Message
    ↓
Channel Entity Lookup (via discord_entities)
    ↓
Fact Evaluation ($if conditions, $respond directives)
    ↓
LLM Call (system: entity facts, messages: role-based user/assistant history)
    ↓
Tool Calls (add_fact, update_fact, remove_fact)
    ↓
Response
```

### Variable Unification

- `createBaseContext()` (`src/logic/expr.ts`) — available to both `$if` and templates. Add here for both.
- Template-only (entities, others, memories, history, char, user) — added in `src/ai/template.ts`, not in `$if`.
- Fact macros (`{{entity:ID}}`, `{{char}}`, etc.) — string replacement in `src/ai/prompt.ts`, separate from expression variables.

### Custom Templates

Nunjucks templates override the default system prompt formatting per entity. Implementation in `src/ai/template.ts`.

**Two-layer system prompt:** `system` API parameter (per-entity system template) + system-role messages array (entity definitions, memories, instructions from main template). See `docs/design/decisions.md`.

**`send_as` macro:** `{% call send_as(role) %}...{% endcall %}` designates message roles. Auto-injected at render time. Unmarked text → system-role. No calls → entire output is one system message.

**Template inheritance:** `{% extends "entity-name" %}` — child inherits `send_as` macro from root parent. Circular detection is built in.

**Key behaviors:**
- `null` template (default) = use built-in `DEFAULT_TEMPLATE`
- Entities with different templates get separate LLM calls
- Entities with the same template (including null) share a call
- Limits: 1000 iterations per for-loop, 1MB output
- `{% include %}` — not yet implemented (see TODO.md)

### Bindings

Discord channels/users/servers map to entities via `discord_entities`:
- **Scope resolution**: channel-scoped > guild-scoped > global
- **Channel binding**: Entity responds in that channel
- **Server binding**: Entity responds in all channels of that server, **except private threads** (type 12). Server-bound entities don't respond in private threads by default; `/bind` the thread directly to opt in.
- **User binding**: User speaks as that entity (persona)

Bind permissions are three-layer: entity-side (edit/use permission) + Discord permission gate (Manage Channels for channel-bind, Manage Guild for server-bind) + server-side allowlist override (per-channel/guild in `discord_config`). When a `/config bind` allowlist exists, it replaces the Discord permission gate. See `src/bot/commands/commands.ts` for implementation.

### Access Control

Permission lists are stored as JSON arrays in entity config columns. Role IDs use a `role:` prefix to distinguish from user IDs. Legacy plain snowflakes and usernames still work for permission checks.

- 0 selections on view/edit/use = `"@everyone"` (stored as `JSON.stringify("@everyone")`)
- 0 selections on blacklist = no blacklist (stored as `null`)
- New entities default to owner pre-selected in view and edit

## Commands

| Command | Description |
|---------|-------------|
| `/create [name]` | Create entity |
| `/view <entity>` | View entity facts |
| `/edit <entity>` | Edit facts + memories (modal) |
| `/edit <entity> type:config` | Edit model, context, stream, avatar, memory |
| `/edit <entity> type:System Prompt` | Edit per-entity system prompt template |
| `/edit <entity> type:advanced` | Edit thinking level |
| `/edit <entity> type:permissions` | Edit view, edit, use, blacklist |
| `/delete <entity>` | Delete entity |
| `/transfer <entity> <user>` | Transfer ownership |
| `/bind <target> <entity>` | Bind channel/user (requires entity edit/use + Manage Channels for channel-bind or Manage Server for server-bind by default; `/config bind` lets admins delegate to others) |
| `/unbind <target> <entity>` | Unbind channel/user (same permissions as bind) |
| `/config <scope>` | Configure channel/server bind/sendnote permissions (Manage Channels). Includes `sendnote` allowlist field. |
| `/sendnote <content>` | Add an invisible system-role note to the channel's AI context (requires Manage Messages or `/config sendnote` allowlist) |
| `/sendas <entity> <content>` | Send a message as an entity (requires entity edit+use) or as `@system` (requires Manage Webhooks) |
| `/debug [status]` | Channel state (default); shows system note count and recent note previews |
| `/debug prompt [entity]` | Show system prompt for entity |
| `/debug context [entity] [query]` | Show message context for entity |
| `/debug rag [entity] [query]` | Show embedding status + RAG retrieval results |
| `/trigger <entity> [verb]` | Manually trigger entity response; verb requires persona and sets `interaction_type` |
| `/mute <entity> <duration> [scope]` | Mute an entity or all bots (kill-switch) for a duration (`30s`, `1h30m`, `forever`, etc.) in this channel (default), server, or everywhere. Requires Moderate Members or entity edit access (everywhere requires edit; all-bots-everywhere requires Administrator). Autocomplete offers "🔇 All bots" as a sentinel. |
| `/unmute <entity> [scope]` | Remove an active mute for an entity or kill-switch at the given scope. Same permission requirements as `/mute`. |
| `/forget` | Exclude messages before now from context |
| `/help [topic]` | Show help entity content. All help entities (`help` and `help:*`) have owner-only `$view` so they're hidden from `/view` autocomplete and only reachable via `/help` (which bypasses view-perm checks). The `topic` option has its own autocomplete sourced from `HELP_TOPICS`. |

Help is an entity: `/help`, `/help commands`, `/help expressions`.

## Dev Commands

```bash
bun install          # Install dependencies
bun run dev          # Development with watch (Discord if DISCORD_TOKEN set; web API on port 3000)
bun run dev:api      # Web API only (WEB=true, no Discord required)
bun run start        # Production
bun run lint         # oxlint
bun run check:types  # TypeScript check
bun run debug        # CLI debug tools (embeddings, state, eval)
```

Production runs as a **user** systemd unit (`~/.config/systemd/user/hologram.service`). Restart with `systemctl --user restart hologram.service` — no sudo. (`systemctl list-units` without `--user` still lists it, which is misleading.)

## Environment Variables

```
DISCORD_TOKEN=       # Optional: Discord bot token (bot disabled if unset)
DEFAULT_MODEL=       # Default LLM (google:gemini-3-flash-preview)
GOOGLE_GENERATIVE_AI_API_KEY=  # For google:* models
ANTHROPIC_API_KEY=             # For anthropic:* models (optional)
OPENAI_API_KEY=                # For openai:* models (optional)
# + 14 more providers, each with standard env var (see .env.example)
ALLOWED_MODELS=      # Comma-separated allowlist for $model (e.g. "google:*,anthropic:*")
MAX_RESPONSE_CHAIN=  # Default max consecutive self-response chain depth (default: 3, 0 = unlimited); overridable per channel/guild via /config-chain or /admin config chain
CATCHUP_ON_STARTUP=  # all (default) | lazy | off — backfill missed messages on startup
CATCHUP_RESPOND=     # true | false (default) — respond to recent missed messages
CATCHUP_RESPOND_MAX_AGE_MS=  # Max age to respond to (default: 300000 = 5 min)
LOG_LEVEL=           # debug, info (default), warn, error
WEB=false            # Set to disable the web API server (on by default)
WEB_PORT=3000        # Web API server port (default 3000); PORT= is also accepted as a fallback
DISCORD_CLIENT_ID=   # Discord OAuth app client ID (for web UI login; optional)
DISCORD_CLIENT_SECRET= # Discord OAuth app client secret
DISCORD_REDIRECT_URI=  # OAuth callback URL — must match app settings (e.g. https://host/api/auth/discord/callback)
COOKIE_SECRET=       # 32+ char secret for session cookie signing (default: dev placeholder — set in production)
```

## Logging

Use structured logger from `src/logger.ts`:

```typescript
import { debug, info, warn, error } from "./logger";

debug("Message", { key: "value" });  // Only shown when LOG_LEVEL=debug
info("Message", { key: "value" });
warn("Message", { key: "value" });
error("Message", err, { key: "value" });
```

- **Never use `console.log`** - use the logger functions
- Set `LOG_LEVEL=debug` for verbose output during development
- Context objects are automatically JSON-serialized

## Design Principles

**Everything is an entity.** Characters, locations, items, even help topics.

**Facts are freeform.** No rigid schema. Patterns emerge from conventions.

**Conditions are composable.** Multiple `$if` conditions, all boolean, evaluated in order.

**Dogfooding.** Help system is implemented via entities with facts.

<!-- BEGIN ECOSYSTEM RULES -->

## Ecosystem Design Principles

Cross-cutting principles distilled from the ecosystem's own decisions (synthesized in `docs/decisions/throughlines.md`). Apply them when building new repos and recording decisions. (Already-encoded principles — independent-tools / no-path-deps, the delegation model, CLAUDE.md-as-control-surface — live in their own sections and are not repeated here.)

- **Prefer data over code at every seam.** Serializable AST / struct / JSON over closures, embedded DSLs, or source text — so artifacts cache, replay, transport, and diff.
- **Library-first; projection-from-one-definition.** The typed library is the source of truth; CLI / HTTP / MCP / WebSocket / JSON surfaces are generated projections, never hand-rolled per surface.
- **Capability security.** Hosts grant pre-opened handles; code only attenuates what it is given; nothing forges authority; allow-list over deny-list.
- **The LLM is an oracle at the leaves, never the control loop.** Determinism is a hard invariant: seeded RNG, event-log replay, build-time-only inference. Per-query LLM in the hot loop is a defect.
- **Trust comes from verifiable evidence, not authority.** Verbatim snippets, pinned-commit permalinks, claim→node citation — never a bare reference.
- **Retire, don't deprecate; collapse asymmetries to primitives.** Remove backward-compat aliases rather than carry them; reduce N special cases to their irreducible primitives.
- **Validate against reality; tests are the spec.** Load-bearing substrates are validated against real corpora; fixtures and tests define correctness, not aspirational specs.

## Delegation

The main session is an orchestrator. Allowed actions: `Agent`/`Task*`/`AskUserQuestion`/plan-mode/`ScheduleWakeup`, and Bash limited to `git commit`, `git push`, `git status`, `git log --oneline`. Everything else delegates to a subagent. The hook is evidence of a prompting failure, not a behavioral guide. If a tool call hits the hook AT ALL, the prompt failed to prevent it. Delegate before the decision point, not after.

### Triggers

Before calling Read, Grep, Glob, or any Bash beyond the four git commands — stop. Dispatch an Agent instead.

Before editing any file — stop. Dispatch an Agent. This includes plan files in `~/.claude/plans/`: in plan mode, dispatch a subagent to write to the plan file; do not Write it yourself. The plan file's content must not enter main context.

When you need git context beyond status/log-oneline (a diff, a blame, a show) — dispatch an Agent.

When a tool call is denied by the hook — do not retry, do not narrate. Dispatch the equivalent Agent and continue.

When a code-modifying subagent returns — `git status`, then `git commit` before any user-facing reply.

Before dispatching an Agent that modifies code — scan your prompt for "do not commit" or "based on your findings". Delete them.

Before dispatching: if your prompt says "if you find", "based on your findings", or "as appropriate" — stop. Investigate first; dispatch with the decision made.

When you can't verify something — do not speculate or guess at file locations, names, or contents. Dispatch a Read subagent or ask. Confabulation is failure.

### Model Tiers

- Sonnet — exploration, lookup, mechanical multi-file edits, implementation, default.
- Opus — architectural judgment, design, subagents that themselves spawn subagents.

Always set `subagent_type` and `model` explicitly.

### Prompt Rules

- Never tell a subagent "do not commit." Code-modifying subagents commit their own work.
- Don't ask for a diff summary. After a code-modifying subagent, `git status` in main and dispatch a review Agent if you need to see the diff.
- Don't re-explain CLAUDE.md. Subagents inherit it.
- Cite locations by content ("the block that does X"), not line numbers — files shift between reads.
- Name files explicitly; don't outsource the grep.
- Match agent type to deliverable: `Explore` for lookup/search, `general-purpose` for reports and file-modifying work.
- On unsatisfying output, change something before retrying. Same prompt + same tier = same result.
- Dispatch independent subagents in parallel (multiple Agent blocks in one message).
- Pair `isolation: worktree` with `run_in_background: true`.
- Code-modifying subagents must verify their own changes before returning (re-read the diff, run tests, etc.). The orchestrator does not get a second pass with git diff — that's hook-blocked.

### Workflows

Workflows are allowed in the main session (orchestration tool). Lessons (observed 2026-05-30):

- **Resume does not adopt newly-passed `args`.** `resumeFromRunId` reuses the original run's args; args you pass on resume are ignored. Never branch run-mode (e.g. dry-run vs write) on an arg you intend to flip across a resume — it won't flip. Bake the mode into a script constant (the script IS re-read on resume) or use a separate script.
- **Never route large content through one agent for verbatim reproduction.** An agent asked to echo ~100k tokens is slow, costly, and silently truncates. The workflow JS sandbox cannot write files, so all writes go through agents — keep each agent's write payload small and batch many small files per agent, not one giant blob through one agent. For review data, prefer the workflow's structured return value over having an agent transcribe a report file.
- **A resume that produces no expected output is a signal — find the cause before patching a symptom.** (Here: the first write-resume wrote nothing and re-ran a giant report agent; the real cause was args not flipping across resume, not the report agent. Guarding the report agent alone did not fix it.)
- **Gate expensive fan-outs behind a dry-run, and confirm cache reuse before the costly stage.** Mining/read fan-out is the dominant cost; verify it's cached (not re-running) before resuming into write.

## Hard Constraints

- No Edit/Write/NotebookEdit in main. Plan files in `~/.claude/plans/` are written by subagents, not by main.
- No Read/Grep/Glob/NotebookRead in main. Delegate.
- No Bash in main beyond `git commit`, `git push`, `git status`, `git log --oneline`.
- No `--no-verify`. Fix the issue or fix the hook.
- No path dependencies in `Cargo.toml` — they couple repos and break independent publishing.
- No interactive git (no `git rebase -i`, no `git add -i`, no `--no-edit` on rebase).
- No suggesting project names. LLMs are bad at this; refine the conceptual space only.
- No tracking cross-project issues in conversation — they go in TODO.md in the affected repo.
- No ecosystem changes without checking all affected repos.
- No assuming a tool is missing without checking `nix develop`.
- Commit completed work in the same turn it finishes. Uncommitted work is lost work.

## Meta

- Something unexpected is a signal. Stop and find out why. Do not accept the anomaly and proceed.
- Corrections from the user are conversation, not material for new rules. Rules are added when a failure mode is observed repeatedly.

<!-- END ECOSYSTEM RULES -->

## Core Rules

- **No cutting corners. Ever.** If state needs to persist, use the database. If something needs tracking, track it properly. No "resets on restart is fine" or in-memory shortcuts for persistent data.
- **Never reimplement.** If logic exists elsewhere, import and use it. No local copies of functions, no "simplified versions for this use case." Find the canonical implementation and make it work.
- **Note things down immediately:** problems, tech debt, issues → TODO.md. If you see ANY issue while working - inconsistency, bug, missing feature, tech debt - add it to TODO.md before you forget.
- **Keep SUMMARY.md files current.** Every directory under `src/` and `docs/` needs a `SUMMARY.md` describing its purpose and contents. When you add, remove, or significantly change files in a directory, update that directory's `SUMMARY.md`. The pre-commit hook runs `normalize rules run` — a `stale-summary` warning means the SUMMARY.md is out of date and must be refreshed before committing.
- **Always write tests for new features.** Every new feature, bug fix, or behavior change must include corresponding tests. Tests go in `*.test.ts` files next to the code they test. Run `bun test` to execute.
- **Single-instance project — no DB migrations.** There is only one deployed Hologram database. When schema changes, edit `CREATE TABLE` / `CREATE INDEX` in `src/db/schema.ts` directly and apply the change to `hologram.db` manually (`sqlite3 hologram.db "ALTER TABLE ..."` or a one-shot `bun -e` script). Do not add `ALTER TABLE` / recreate-table migration blocks — `schema.ts` should describe the current state, not history.
- **Coverage refresh rule.** At the start of each session, read `test/coverage-meta.json`. If either condition is true, run `bun test --coverage`, update the file, and commit it:
  - `git rev-list <meta.commit>..HEAD --count` ≥ 5 commits since last run, OR
  - Days elapsed since `meta.date` ≥ 7
  - Update format: `{ commit, date (YYYY-MM-DD), lines (%), functions (%), tests (count) }`

## Hard Constraints

- No interactive git commands (`git add -p`, `git add -i`, `git rebase -i`) — these block on stdin and hang in non-interactive shells; stage files by name instead
- No `--no-verify` — fix the issue or fix the hook
- Don't assume tools are missing — check if `bun` is available
- Use `as any` type assertions or `type Foo = any` aliases - they hide type errors and indicate missing/wrong types. Fix the underlying type issue instead (add proper desiredProperties, use correct property paths like `toggles.nsfw` instead of `nsfw`, etc.). For Discordeno types, use `typeof bot` from `src/bot/client.ts` to get the fully-resolved `Bot<TProps, TBehavior>` without manually threading generics.
- **Never downgrade fidelity.** When storing or rendering Discord data (embeds, components, attachments, etc.), preserve the full structure. Never flatten rich data to "just text" — store the complete data and render it properly in templates. (`embed.toJSON()` in the default template is intentional — see `docs/design/decisions.md`.)
- **`sqlite-vec` returns `Uint8Array`, not `Float32Array`.** Always convert: `new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4)`. Affects `fact_embeddings` and `memory_embeddings`.
- **`Object.create(null)` breaks Nunjucks.** Use `{}` instead.
- **Config columns need safe JSON fallbacks.** All `JSON.parse` calls on DB config columns (permissions, delimiters, strip patterns) must use `safeParseFallback()` (`src/db/entities.ts`) or `safeJsonParse()` (`src/bot/client.ts`). Corrupted data otherwise crashes the command handler.
- **Non-responding entities need `processRawFacts()`.** Entities in the `others` and user persona slots receive raw DB facts — they must go through `processRawFacts()` from `src/ai/prompt.ts` to strip `$if` prefixes and directives before being passed to templates.
- **`buildEvaluatedEntity` mock context** (`src/debug/evaluation.ts`) omits real runtime values like `unread_count`. When adding new `ExprContext` fields, also update the mock there.

## Commits

Use conventional commits: `type(scope): message`

Types: `feat`, `fix`, `refactor`, `docs`, `chore`, `test` (no `perf` — the hook will reject it)

Before committing: `bun run lint && bun run check:types` must pass. The pre-commit hook also runs `normalize rules run` — fix any `error`-severity issues it reports (e.g. `hardcoded-secret`). Warnings (e.g. `missing-summary`, `stale-summary`) won't block the commit but should be addressed.
