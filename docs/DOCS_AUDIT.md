# Docs Staleness Audit

Generated 2026-03-08. Covers `src/` commits in the last 30 days vs. corresponding docs updates.

---

## Stale Docs — Code Changed After Docs

| Doc file | Doc last updated | Code change that post-dates it |
|----------|-----------------|-------------------------------|
| `docs/reference/directives.md` | `a4fead4` (2026-02-08, `$thinking`) | `$safety` / `$nsfw` (`131ce3d`, `366229e`, 2026-03-07–08) — **completely undocumented** |
| `docs/reference/directives.md` | `a4fead4` (2026-02-08) | `$collapse` directive (`809da96`, `7f56052`, 2026-03-07) — **undocumented** |
| `docs/reference/triggers.md` | `8e4408f` (2026-02-26, `is_hologram`) | No new trigger variables added since — up to date |
| `docs/reference/templates.md` | `6823d19` (latest) | Up to date (covers attachments, embeds, stickers, Components v2) |
| `docs/reference/facts.md` | `8e34e9b` (convenience macros) | No new macro changes since — up to date |
| `docs/reference/commands.md` | `aff1f5a` (bind/unbind) | No new commands since — up to date |
| `docs/guide/channel-setup.md` | `9af9c39` (multi-entity refactor) | No breaking changes to binding since — likely up to date |
| `docs/guide/transformations.md` | `218502e` (random() return type) | `$safety` / `$nsfw` / `$collapse` affect output — but guide scope is narrower |
| `docs/README.md` | `9f38a10` (entity-facts rebuild) | Very old; missing: `$thinking`, `$collapse`, `$safety`, `CATCHUP_*` env vars, attachment pipeline, `/trigger` command (though CLAUDE.md covers some of this) |

---

## `src/` Feat/Refactor Commits in Last 30 Days With No Corresponding Docs Update

| Commit | Description | Docs impact | Docs updated? |
|--------|-------------|-------------|---------------|
| `366229e` 2026-03-08 | `refactor(safety): generalize $nsfw into $safety` | `directives.md` needs `$safety` entry | No |
| `131ce3d` 2026-03-07 | `feat(nsfw): add $nsfw directive` | `directives.md` needs `$nsfw` / `$safety` entry | No |
| `809da96` 2026-03-07 | `feat(expr): add $collapse directive` | `directives.md` needs `$collapse` entry | No |
| `7f56052` 2026-03-07 | `feat(expr): change $collapse from boolean to role set` | Same — no docs exist for `$collapse` | No |
| `73cdf20` 2026-03-07 | `feat(bot): advanced modal V2 with StringSelect for collapse` | UX change for `/edit type:advanced`; `commands.md` may need note | No |
| `539099e` 2026-03-07 | `feat(attachments): proxy external images` | Behaviour change (images now fetched server-side); no user-facing docs needed unless noting latency | No |
| `ac3caa5` 2026-03-07 | `feat(images): multimodal image output` | New capability (LLM can return images); worth a note in templates or a guide section | No |
| `ffd028c` 2026-03-07 | `feat(attachments): HATT marker protocol` | Internal; `templates.md` covers the user-visible `attach()` side | Partially (via `6823d19`) |
| `a71464d` 2026-02-19 | `feat(bot): backfill missed messages on startup` | `CATCHUP_ON_STARTUP`, `CATCHUP_RESPOND`, `CATCHUP_RESPOND_MAX_AGE_MS` env vars — not in any user doc | No |
| `c02dc87` 2026-02-16 | `feat(bot): capture/render Discord Components v2` | Covered in `templates.md` via `7a6de5a` | Yes |
| `8dc5425` 2026-02-06 | `feat(expr): add unread_count variable` | Listed in triggers doc via same commit | Yes |

---

## Priority Fixes Needed

1. **`docs/reference/directives.md`** — Add `$safety` (replaces `$nsfw`, accepts threshold keywords: `none`, `low`, `medium`, `high`) and `$collapse` (role set controlling adjacent-message merging).
2. **Any env-var reference** — Document `CATCHUP_ON_STARTUP`, `CATCHUP_RESPOND`, `CATCHUP_RESPOND_MAX_AGE_MS` (currently only in CLAUDE.md, not user docs).
3. **Multimodal image output** — Note in `templates.md` or a new guide section that entities can now return generated images.
4. **`docs/README.md`** — Substantially out of date; missing entire feature classes added since initial entity-facts rebuild.
