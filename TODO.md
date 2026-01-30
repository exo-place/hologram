# TODO

## Tech Debt

### Dependencies

- **@discordeno/bot** pinned to `22.0.1-next.ff7c51d` - stable v21 has a bug where webhook query params (`wait` + `thread_id`) aren't joined with `&`, breaking thread posts. Fixed in next/beta but not released to stable yet.

### Test Coverage

Current: 690 tests across `src/logic/expr.test.ts`, `src/logic/expr.security.test.ts`, `src/logic/safe-regex.test.ts`, and `src/ai/template.test.ts`. Covers:
- Expression evaluator (tokenizer, parser, operators, precedence)
- Security (identifier whitelist, injection prevention, prototype access)
- Adversarial sandbox escapes (184 tests): prototype chains, global access, constructors, module system, bracket notation, code injection, statement injection, unsupported syntax, call/apply/bind, string/array method abuse, DoS vectors (ReDoS + memory exhaustion runtime-bounded: repeat, padStart, padEnd, replaceAll, join), unicode tricks, numeric edge cases, known CVE patterns, combined multi-vector attacks, prototype-less objects, evalMacroValue sandbox
- Safe regex validation (148 tests): safe patterns accepted, capturing groups/nested quantifiers/backreferences/lookahead rejected, safety invariant exhaustive, integration with expr evaluator (match/search/replace/split), matchAll blocked, real-world ReDoS patterns
- Accepted risks (documented): quadratic regex bounded by Discord message length, array mutation contained to context, no runtime timeout (mitigated by static analysis), unrestricted safe string methods
- Self context parsing
- Fact parsing and evaluation ($if, $respond, $retry, $locked, $avatar, $stream, $model, $context, $strip)
- Permission directives ($edit, $view, $use, $blacklist, $locked, role ID matching)
- Roll20 dice (kh, kl, dh, dl, exploding, success counting)
- Utility functions (formatDuration, parseOffset)
- New ExprContext functions (duration, date_str, time_str, isodate, isotime, weekday, group)
- messages() with filter ($user, $char)
- Discord emote edge cases
- Real-world entity evaluation
- Template engine (Nunjucks) security (142 tests): prototype chain escapes, RCE via constructor chains, global object access blocked, built-in constructor access blocked, call/apply/bind blocked, matchAll blocked, string method memory limits, loop iteration cap (1000), output size cap (1MB), ReDoS regex validation, context prototype leakage contained, known CVE patterns, multi-vector combined attacks, filter functionality, whitespace control, structured context rendering

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

- [ ] Strip prompt scaffolding - remove `<defs>` XML tags and unnecessary structure from system prompt
- [ ] Silent failure elimination - when no entities are bound, explain why nothing happened instead of silently returning
- [ ] Dynamic token allocation - adapt context window based on conversation rather than hardcoded 16k char default

### Multi-Character

- [ ] Known but not speaking - non-responding entities bound to a channel should be included in LLM context with a `<known_entity>` marker so the LLM knows they're present but shouldn't speak for them

### Features

- [ ] Zero-command start - mention with no binding → prompt "who should I be?" → auto-create and respond
- [ ] Shareable entity template presets
- [ ] Clone/fork functionality with permissions
- [ ] Channel permission inheritance - should channel-bound entities inherit permissions from the channel entity?

---

## Backlog

### Bot Message Visibility

Other Discord bots' messages are partially invisible in message history:

- **Embed-only messages are dropped:** `client.ts:223` bails on `!message.content && !message.stickerItems?.length`. Bots like Nekotina that respond entirely via embeds (title/description/fields) produce no `content`, so they're silently dropped. The conversation history has gaps where bot interactions happened but aren't recorded.
- **Text-content bot messages are included but unlabeled:** Bots that do send regular `content` are stored and appear in LLM context identically to human users (`BotName: message`). The LLM has no way to distinguish them from humans.
- **No `isBot` check exists anywhere:** Only the bot's own user ID is filtered (`client.ts:222`). Discord's `message.author.bot` flag is never inspected.
- **`$user` filter misclassifies bot messages:** In `messages(n, fmt, "$user")`, bot messages count as "user" messages since they have no `webhook_messages` entry. Only Hologram's own webhook messages are classified as `$char`.

Possible improvements:
- Serialize embed-only messages minimally (e.g. `BotName [bot]: embed title - embed description`) so they appear in history
- Add `[bot]` suffix to author names for `message.author.bot === true` so the LLM can distinguish them
- Add `$bot` filter to `messages()` function for entity-level control
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

Template engine migrated to Nunjucks with runtime security patches. The following features require a template loader that resolves entity names to template sources:

- [ ] `{% extends "base-prompt" %}` — template inheritance, resolves entity name to template source
- [ ] `{% include "shared-facts" %}` — template inclusion
- [ ] `{% macro %}` — reusable template macros
- [ ] `{% set %}` — variable assignment within templates

---

### Structured Messages Refactor

Current state: all message history is formatted as `"author: content\n..."` and sent as a single user message. Templates get structured `history` objects but the LLM API still uses flat text.

- [ ] **Role-based messages**: Model responses should be `assistant` messages, not packed into a single `user` message. The AI SDK supports `messages: [{role: "user", ...}, {role: "assistant", ...}]` — use it.
- [ ] **JSON blob storage**: Add a `data JSON` column to the `messages` table storing the full structured Discord message (embeds, stickers, attachments, author metadata, `is_bot` flag). SQLite `json_extract()` for queries, raw objects for template context.
- [ ] **Template integration**: Templates get rich message objects (`msg.embeds`, `msg.stickers`, `msg.attachments`, `msg.is_bot`) instead of flat `{author, content}`.
- [ ] **API-specific formatting via `{% extends %}`**: Template inheritance with entity-name-based loader (`{% extends "base-prompt" %}` resolves to that entity's template). Enables API-specific message/attachment blocks.
- [ ] **`$user`/`$char`/`$bot` classification**: Currently `$user` filter misclassifies bot messages. With `is_bot` stored, fix classification.
- [ ] **Embed serialization**: Embed-only messages (currently dropped at `client.ts:223`) should be serialized minimally into the `data` blob.

---

## Low Priority

- [ ] Regex literal support in `$if` expressions - `/pattern/` syntax as alternative to string-based `.match()`. Low priority since `.match("pattern")` now works with safe regex validation
- [ ] `$emojis` macro - expand to list of custom guild emojis for LLM context
- [ ] Hearing distance / proximity awareness between entities
