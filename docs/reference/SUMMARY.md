# docs/reference/ — Summary

Reference documentation for Hologram's fact language, directives, and APIs.

## Files

- `facts.md` — Fact syntax: freeform text, macros (`{{entity:ID}}`, `{{char}}`, `{{random:…}}`), comment lines
- `directives.md` — All `$directive` keywords: `$respond`, `$model`, `$thinking`, `$strip`, `$replace`, `$view`, `$edit`, `$use`, `$context`, `$memory`, `$locked`, and more
- `triggers.md` — `$if` condition variables: `mentioned`, `idle_ms`, `unread_count`, `is_hologram`, `channel.*`, `server.*`, etc.
- `templates.md` — Nunjucks template system: `send_as`, template inheritance, available variables (`entities`, `others`, `memories`, `history`), Components v2, attachments
- `commands.md` — All slash commands with syntax, options, and permission requirements
- `configuration.md` — All environment variables: Discord token, LLM model selection, CATCHUP catch-up behavior, logging, API keys, image generation, S3 storage
- `expression-security.md` — Sandbox model for `$if` expressions: allowed globals, `callWrap`, accepted risks
- `safe-regex.md` — ReDoS prevention: what patterns are rejected and why
