# TODO

## Open Threads

*Open threads from a previous session. Treat as starting context, not instructions — verify relevance before acting.*

### Rate Limiting (channel spam / runaway cascade) — RESOLVED 2026-04-26

Per-channel/per-owner/per-entity sliding-window rate limits implemented and persisted in `entity_events`. Mute system (`entity_mutes`) provides channel/guild kill switches. `/admin` command exposes all controls. See `docs/reference/configuration.md` → Rate Limiting section and `src/db/moderation.ts`.

---

### Security hardening (2026-04-26) — RESOLVED

Four security gaps reported by luvoid/Hazel/n_n and one feature (/purge) implemented:

1. **Confused-deputy (server-bound entities)** — `canOwnerReadChannel()` checks VIEW_CHANNEL + READ_MESSAGE_HISTORY for entity owners before responding. Server-bound entities skip channels their owner can't read. `/debug status` annotates skipped entities. (`src/bot/commands/cmd-permissions.ts`, `src/bot/client.ts`, `src/bot/commands/cmd-debug.ts`)

2. **Cross-entity view leakage** — `{{entity:ID}}` macros and `{% extends "Name" %}` template inheritance now require the calling entity's owner to have view permission on the referenced entity. Denied refs leave the macro unexpanded. (`src/ai/prompt.ts`, `src/ai/template.ts`)

3. **Cross-entity tool-call edits** — `add_fact`, `update_fact`, `remove_fact`, `save_memory`, `update_memory`, `remove_memory` now verify the calling entity's owner has edit permission on the target entity. Self-edits always allowed; no caller context = no check (backward compat). (`src/ai/tools.ts`)

4. **`/bind` default-allow-everyone** — Now requires Manage Channels (channel-bind) or Manage Server (server-bind) by default. `/config bind` allowlists override this for delegated access. (`src/bot/commands/commands.ts`)

5. **`/purge` command** — Delete bot messages by substring or range (1=most recent). Permission: Manage Webhooks or `$delete` directive. Audit-logged to `mod_events`. Web equivalent: DELETE `/api/channels/:id/messages/:msgId` + × button in chat UI. (`src/bot/commands/cmd-delete.ts`, `src/api/routes/chat.ts`)

6. **`$delete` permission** — `config_delete` column, `canUserDelete()`, `/edit type:permissions` modal field, web ConfigEditor field, `deleteList` in `EntityPermissions`.

Remaining:
- Per-guild permission checks for moderation API still not implemented (any logged-in Discord user can call it when OAuth active — deferred).

### More Discord feedback — next session starting point

User mentioned "more feedback from discord" as context for this session. Unknown what specific feedback — next session should ask before building anything. Could be complaints about the new moderation system, UX feedback on `/admin`, cascade incident follow-up, or unrelated.

---

### Discord OAuth — env-gated, moderation routes now accessible

Moderation routes (`/api/mutes`, `/api/audit`, `/api/guilds/*/config`, `/api/channels/*/config`) are now open when `DISCORD_CLIENT_ID` is unset (private deployment mode — `actor_id` records as `"local"`). OAuth enforcement activates automatically when the env var is set.

Remaining open questions:
- Per-guild permission checks not implemented — any logged-in Discord user can call the moderation API when OAuth is active. Enforcing Discord guild-member permissions (Manage Guild / Manage Channels bitfield check via Discord API) is deferred.
- `COOKIE_SECRET` defaults to a dev placeholder — needs to be set in production before OAuth is actually enabled, or sessions are forgeable.

---

### `/edit type:advanced` — per-entity rate limit field not added

The plan called for adding a "Per-entity rate limit (msg/min)" field to the existing advanced-edit modal (`src/bot/commands/cmd-edit.ts`). This was NOT done — the `config_rate_per_min` column exists in the DB and is read by `checkRateLimits`, but there's no UI to set it from Discord. Currently only settable via the web API (`PATCH /api/entities/:id/config`).

---

### Rate-limit DM deep link — not implemented

Phase 6 plan mentioned DM warnings should include a deep link to `https://<host>/entities/:id`. The warn DM currently mentions `/edit <entity> type:advanced` for entity-scope limits and `/admin config rate` for channel/owner limits, but has no URL link. May want to add once web host is known/configured.

---

### `entity_events` GC — startup-only, not periodic

`gcOldEvents(7)` runs once at startup (`src/index.ts`). On long-running instances, events older than 7 days accumulate between restarts. Probably fine for the single-instance deployment with regular restarts, but worth noting. A periodic timer (e.g. daily) would be more robust. Same applies to `gcExpiredMutes()`.

---

## Behaviour Changes (2026-04-26)

- **`resolveDiscordConfig` now uses field-level precedence** — Previously, if a channel row existed, all its NULL fields masked the guild row (row-level precedence). Now each field falls through independently: a NULL channel value inherits the guild value. This is a behavioural change for `bind`/`persona`/`blacklist` in channels that have a config row for one field but not others. In practice, most deployments set all three fields together via `/config`, so the impact should be minimal. The new behaviour is tested in `src/db/discord.test.ts` "field-level precedence" suite.

## Audit Findings (2026-03-08)

Findings from parallel consistency + gaps + adversarial audit across entire codebase.

### Critical

- [x] **`resolveDiscordConfig()` bare `JSON.parse`** — fixed: uses `safeParseFallback()` throughout `discord.ts`.
- [x] **`buildConfigLabels()` bare `JSON.parse`** — fixed: `safeParseFallback()` in `commands.ts`.
- [x] **Role detection permission bypass** — fixed: `buildEntries` uses `flatMap`; drops IDs not found in either `resolved.roles` or `resolved.users` rather than silently treating them as user IDs.
- [x] **`responseChainDepth` never resets** — fixed: unconditionally deleted on any non-bot, non-webhook message before depth check.
- [x] **Failing test: emoji HATT mime type** — fixed: `buildParseEmojisFn` now emits `image/webp` for static emojis.
- [x] **`webhook_messages` missing FK constraint** — fixed: `REFERENCES entities(id) ON DELETE CASCADE` added + migration for existing DBs.

### High

- [x] **Duplicate safe-JSON helpers** — fixed: `safeJsonParse` deleted; `configToDefaults`/`configToPermissionDefaults` deleted; all callers use `safeParseFallback`/`getEntityEvalDefaults`/`getPermissionDefaults` from `entities.ts`.
- [x] **Nunjucks `callWrap` sandbox uses regex name extraction** — investigated 2026-03-08. Nunjucks always generates `obj["method"]` bracket notation for member calls; the regex `/\["(\w+)"\]$/` reliably extracts the final method name. Two bypass patterns exist (`(s.apply)(args)` → `--expression--`; `{% set fn = s.apply %}{{ fn(args) }}` → `fn`), but neither is exploitable: `memberLookup` blocks `.constructor` at property-access time (no path to Function), strict-mode `new Function` means `null` thisArg does not grant globalThis access, and the only callable functions are safe context closures. Accepted — documented in `template.ts` callWrap comment.
- [x] **`expr.ts` property traversal uses blocklist** — investigated 2026-03-08. Whitelist is not viable: property names come from user-defined facts (`self.health`, `self.fox_tf`, etc.) and Discord metadata with unbounded key sets. The blocklist is complete for prototype chain escape because: (1) bracket notation is not parsed — only dot-notation member access, so property names are always static AST literals; (2) the seven blocked names cover every standard prototype/descriptor API. Accepted — documented in `expr.ts` generateCode `member` case comment.
- [x] **0% test coverage on 23 slash commands** — fixed: `helpers.ts` extracts pure functions; 68 tests cover all 5 permission check paths, `buildEntries` security fix, role/user/blacklist, channel > guild scope. Also fixed `chunkContent` hard-split bug (dropped char at boundary).
- [x] **Critical-path modules at near-zero coverage** — fixed: streaming (22 tests), tools (44 tests), memories (35 tests), effects (22 tests), attachment-cache (22 tests), DB schema/constraints/cascades (34 tests), webhooks (15 tests).

### Medium

- [x] **`MAX_RESPONSE_CHAIN=0` allows infinite self-response** — fixed: 0 is rejected at startup, defaults to 3 with a warning.
- [x] **`safe-regex.ts` parser has no depth/node limit** — fixed: 500-char input limit + 2000-node count limit added with tests.
- [x] **Template nonce marker injection** — fixed: split into two independent nonces per render (`hmsgNonce` never exposed to templates; `hattNonce` used by `attach()`/`parse_emojis()`). Forgery attack blocked and tested.

### Low

- [x] **`is_self` by name comparison** — fixed: uses `getWebhookMessageEntity()` for ID-based lookup; falls back to name comparison only for pre-bot messages (with debug log).

---

## Tech Debt

### Dependencies

- **@discordeno/bot** pinned to `22.0.1-next.ff7c51d` - stable v21 has a bug where webhook query params (`wait` + `thread_id`) aren't joined with `&`, breaking thread posts. Fixed in next/beta but not released to stable yet.

### Test Coverage

Current: 1291 tests across `src/logic/expr.test.ts`, `src/logic/expr.security.test.ts`, `src/logic/expr.date.test.ts`, `src/logic/safe-regex.test.ts`, `src/ai/template.test.ts`, `src/ai/template-output.test.ts`, `src/ai/template-parity.test.ts`, and `src/ai/attachments.test.ts`. Covers:
- Expression evaluator (tokenizer, parser, operators, precedence)
- Security (identifier whitelist, injection prevention, prototype access)
- Adversarial sandbox escapes (184 tests): prototype chains, global access, constructors, module system, bracket notation, code injection, statement injection, unsupported syntax, call/apply/bind, string/array method abuse, DoS vectors (ReDoS + memory exhaustion runtime-bounded: repeat, padStart, padEnd, replaceAll, join), unicode tricks, numeric edge cases, known CVE patterns, combined multi-vector attacks, prototype-less objects, evalMacroValue sandbox
- Safe regex validation (148 tests): safe patterns accepted, capturing groups/nested quantifiers/backreferences/lookahead rejected, safety invariant exhaustive, integration with expr evaluator (match/search/replace/split), matchAll blocked, real-world ReDoS patterns
- Accepted risks (documented): quadratic regex bounded by Discord message length, array mutation contained to context, no runtime timeout (mitigated by static analysis), unrestricted safe string methods
- Self context parsing
- Fact parsing and evaluation ($if, $respond, $retry, $locked, $avatar, $stream, $model, $context expression predicates, $strip)
- Permission directives (config-based $edit, $view, $use, $blacklist via defaults; $locked from facts; role ID matching)
- Roll20 dice (kh, kl, dh, dl, exploding, success counting)
- Utility functions (formatDuration, parseOffset)
- New ExprContext functions (duration, date_str, time_str, isodate, isotime, weekday, group, pick)
- Safe Date wrapper (78 tests): Date.new(), Date.now(), Date.parse(), Date.UTC(), instance methods, prototype chain escape prevention, RCE via constructor blocked, edge cases, real-world use cases
- messages() with filter ($user, $char)
- Discord emote edge cases
- Real-world entity evaluation
- Template engine (Nunjucks) security (150 tests): prototype chain escapes, RCE via constructor chains, global object access blocked, built-in constructor access blocked, call/apply/bind blocked, matchAll blocked, string method memory limits, loop iteration cap (1000), output size cap (1MB), ReDoS regex validation, context prototype leakage contained, known CVE patterns, multi-vector combined attacks, filter functionality, whitespace control, structured context rendering, send_as security (not available in plain render, role injection safe, prototype chain blocked, hattNonce-to-HMSG forgery blocked via separate nonces)
- Template tests (43 tests): DEFAULT_TEMPLATE snapshot tests (system prompt + messages for single/multi entity, freeform, memories, others, no entities, empty history), adversarial injection (nonce-like markers, template syntax in content), send_as protocol tests (role designation, for-loop, unmarked text interleaving, empty filtering, legacy compat), block invisibility tests (blocks are organizational only), renderSystemPrompt tests, template inheritance
- Attachment tests (HATT protocol): marker emission, nonce isolation, image/file/URL part resolution, parse_emojis, sticker helpers, capability detection (vision, document type)

---

### Expression Evaluation Timeout

The expression evaluator (`src/logic/expr.ts`) runs `new Function()` synchronously on the event loop with no timeout. Static analysis (regex validation, blocked methods) mitigates most DoS vectors, but defense-in-depth would benefit from a runtime timeout. Options:
1. Move evaluation to a worker thread with a deadline — comprehensive but adds complexity
2. `Promise.race` with `setTimeout` — doesn't actually interrupt synchronous JS execution
3. Accept the risk — static analysis covers regex and memory exhaustion; remaining vectors (quadratic regex like `(?:a|a)+` on bounded Discord messages) are limited by input size

---

## Architecture

See `docs/postmortem/2026-01-26-ux-critique.md` for full analysis.

### Prompt & Context

- [ ] Silent failure elimination - when no entities are bound, explain why nothing happened instead of silently returning
- [x] Dynamic token allocation - `$context` now supports expression predicates (`chars`, `count`, `age_h`, etc.) with default `chars < 4000 || count < 20`

### Multi-Character

- [ ] Known but not speaking - non-responding entities bound to a channel should be included in LLM context with a `<known_entity>` marker so the LLM knows they're present but shouldn't speak for them

### Permissions

- [x] **Admin unbind** — server admins (Manage Channels) should be able to unbind any entity from any channel/guild in their server, even if they don't have edit/use permission on the entity. Currently unbind requires entity edit/use permission.
- [x] **$safety directive** — `$safety [category] threshold-or-expr` controls per-category content filter thresholds. Categories: `sexual`, `hate`, `harassment`, `dangerous`, `civic` (or omit for all). Threshold: `off`, `none`, `low`, `medium`, `high`, or a boolean expression (`channel.is_nsfw`, `true`/`false`). `$nsfw` remains as backward-compat alias for `$safety` (all categories). Removes implicit `channel.is_nsfw` default — explicit opt-in required.

### Features

- [ ] Zero-command start - mention with no binding → prompt "who should I be?" → auto-create and respond
- [ ] Shareable entity template presets
- [ ] Clone/fork functionality with permissions
- [ ] Channel permission inheritance - should channel-bound entities inherit permissions from the channel entity?
- [ ] Mentionable select for permissions UI - use Discord's [mentionable select](https://discord.com/developers/docs/components/reference#mentionable-select) for `$edit`, `$view`, `$use`, `$blacklist`. 0 selections = @everyone, placeholder text explains "if blank, everyone can view/edit/use"

---

## Backlog

### Bot Message Visibility

Mostly resolved by the structured messages refactor:

- ~~**Embed-only messages are dropped**~~ — Now serialized as `title — description` into content, with full embed data in `data` JSON blob.
- **Text-content bot messages are included but unlabeled:** Bots that send regular `content` are stored identically to human users (`BotName: message`). The LLM has no way to distinguish them in the message history. The `data.is_bot` flag is stored but not yet surfaced in LLM context formatting (only in template `history` objects and `$user`/`$bot` filters).
- ~~**No `isBot` check exists anywhere**~~ — `message.author.toggles.bot` is now checked and stored as `data.is_bot`.
- ~~**`$user` filter misclassifies bot messages**~~ — `$user` now excludes bot messages; new `$bot` filter added.

Remaining improvements:
- Add `[bot]` suffix to author names in LLM context so models can distinguish bots from humans
- Consider a `$ignore_bots` directive to let entities opt out of seeing bot messages entirely
- Default behavior TBD: most bot embeds (leaderboards, stats, game results) are noise for RP context, but some are conversational

---

### Template Poisoning Risk

Custom templates control the entire system prompt. A malicious template on one entity could manipulate how other entities' facts are presented in the same LLM call (e.g., injecting instructions, hiding facts, reframing context). Mitigated by:
- Template-based grouping (entities with different templates get separate calls)
- Only entity owner/editors can set a template (same permission model as facts)
- Entities sharing a template are presumed to trust the same author

Future consideration: channel-level or server-level templates as an alternative scope that reduces cross-entity influence.

---

### Deferred Template Features

Template engine migrated to Nunjucks with runtime security patches. Entity-name-based template loader implemented for `{% extends %}`.

- [x] `{% extends "base-prompt" %}` — template inheritance, resolves entity name to template source
- [ ] `{% include "shared-facts" %}` — template inclusion
- [x] `{% macro %}` — reusable template macros (send_as is a macro; user-defined macros work via Nunjucks)
- [x] `{% set %}` — variable assignment within templates (supported by Nunjucks)

---

### Structured Messages Refactor

Current state: message history uses role-based `user`/`assistant` messages via `preparePromptContext()` in `prompt.ts` (shared by handler.ts, streaming.ts, and debug commands). Both custom templates and the built-in `DEFAULT_TEMPLATE` produce structured output via `send_as()` macro protocol (plain-text nonce markers). Templates get rich structured `history` objects with `is_bot`, `role`, `embeds`, `stickers` (now `{id, name, format_type}` objects), `attachments`. Bot messages are tracked via `data` JSON column.

- [x] **Role-based messages**: Model responses are `assistant` messages using AI SDK structured messages array. `buildPromptAndMessages()` in `prompt.ts` assigns roles based on `webhook_messages` lookup.
- [x] **JSON blob storage**: `data TEXT` column on `messages` table stores `MessageData` JSON (is_bot, embeds, stickers, attachments). SQLite `json_extract()` used for `$user`/`$bot` classification.
- [x] **Template integration**: Templates get rich history objects (`msg.is_bot`, `msg.embeds`, `msg.stickers`, `msg.attachments`).
- [x] **API-specific formatting via `{% extends %}`**: Template inheritance with entity-name-based loader (`{% extends "base-prompt" %}` resolves to that entity's template). Enables API-specific message/attachment blocks.
- [x] **`$user`/`$char`/`$bot` classification**: `$user` excludes bot messages via `json_extract(data, '$.is_bot')`. New `$bot` filter for other Discord bot messages.
- [x] **Embed serialization**: Embed-only messages serialized into content (`title — description`) and stored with full embed data in `data` blob.

---

## Web Frontend

- [x] Phase 1: REST API (`src/api/`) — entity CRUD, chat channels, debug endpoints, SSE, conditional startup
- [x] Phase 2: SolidJS SPA (`web/`) — entity list/detail, fact/config/template/memory editors, chat view, debug panel
- [x] Phase 3: Chat adapter (`src/api/chat-adapter.ts`) — evaluateFacts + handleMessageStreaming + broadcastSSE
- [x] Phase 4: Monaco template editor — hologram-dark theme, hologram-template tokenizer, lazy-loaded
- [~] Authentication: Discord OAuth2 landed but optional — moderation routes are open when `DISCORD_CLIENT_ID` is unset (private deployment). Per-guild permission checks not yet implemented. See open thread above.

---

## Low Priority

- [ ] In-memory test DB — `buildPromptAndMessages()` and the full prompt pipeline (`preparePromptContext` → handler/streaming) require DB access (`getMessages`, `getWebhookMessageEntity`, etc.) and can't be tested statically. A `:memory:` SQLite instance with test fixtures would enable integration tests for edge cases like the 0-messages fallback and empty-history scenarios
- [ ] Regex literal support in `$if` expressions - `/pattern/` syntax as alternative to string-based `.match()`. Low priority since `.match("pattern")` now works with safe regex validation
- [ ] `$emojis` macro - expand to list of custom guild emojis for LLM context
- [ ] Hearing distance / proximity awareness between entities
- [ ] Multi-reply: single LLM trigger replies to multiple prior messages. Needs careful design — tool call approach (LLM calls `reply(message_id, content)` N times), history context needs to expose `discord_message_id`, interactions with streaming/webhooks/response chain logic all need working out
