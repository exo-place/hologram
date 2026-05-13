# src/bot/commands/

Slash command definitions and interaction routing. All user-facing Discord commands live here.

## Key Files

- `cmd-admin.ts` — The `/admin` slash command with subcommand groups: `mute` (create/list/remove/clear), `disable`/`enable` channel/server (kill switches), `config` rate/chain (modal-based), and `audit` (mod event log). Per-subcommand permission checks (Manage Messages/Channels/Webhooks/Administrator). Exports `parseAdminOptions` (subcommand group parser) and `parseDuration` ("10m"|"1h"|"1d"|"forever" → SQLite timestamp) for testing.
- `commands.ts` — The core slash commands: `/create`, `/view`, `/delete`, `/transfer`, `/bind`, `/unbind`, `/config`, `/config-chain`, `/sendnote`, `/trigger`, `/forget`, `/sendas`. Also re-exports permission helpers from `cmd-permissions.ts`. Each command is registered via `registerCommand()` from `index.ts`.
- `cmd-edit.ts` — The `/edit` command and all its modal handlers (facts, config, identity, system prompt, advanced, permissions). Handles multiple `type:` variants using Discord modals and select menus. The `edit-identity` modal includes a Nickname field (max 50 chars) for autocomplete disambiguation.
- `cmd-debug.ts` — The `/debug` command with subcommands: `status`, `prompt`, `context`, `rag`. Shows entity state, rendered prompt/context, and embedding/RAG debug info. `/debug status` also shows system note count and recent note previews.
- `cmd-permissions.ts` — Permission helper functions shared across commands: `canUserEdit`, `canUserView`, `canUserUse`, `canUserDelete`, `canUserBindInLocation`, `canUserPersonaInLocation`, `canUserSendNoteInLocation`, and `canOwnerReadChannel` (async Discord API check — confused-deputy prevention).
- `cmd-delete.ts` — The `/purge` slash command for deleting bot messages and system notes by substring or 1-indexed stack range (e.g. `1-4`). Respects `$delete` permission directive and MANAGE_WEBHOOKS fallback. System notes (no Discord message ID) are deleted DB-only.
- `index.ts` — Command registry and interaction router. Defines `CommandContext`, `CommandHandler`, `registerCommand`, and `registerModalHandler`. `handleInteraction` dispatches incoming Discord interactions to the correct handler. Also contains autocomplete logic (entity search filtered by ownership and permissions) and helper functions `respond`, `respondWithModal`, `respondWithV2Modal`.
- `helpers.ts` — Pure, Discord-free helper functions extracted for unit testability: `chunkContent` (split long text at newlines), `elideText` (keep head+tail within char limit), `buildDefaultValues` (modal pre-fill from current config), `buildEntries` (format config display text).
- `help.ts` — `ensureHelpEntities`: creates or refreshes the built-in help system entities (`help`, `help:start`, `help:commands`, etc.) on startup. Help is implemented as regular entities with facts. None of them set `$view`, so they're owner-only and hidden from `/view` autocomplete; the only public route is `/help [topic]` (which bypasses view-perm checks). Also exports `HELP_TOPICS` (subtopic names without the `help:` prefix) for the `/help` autocomplete.

## Notes

- Three-layer bind permission: entity-side (`$edit`/`$use`) + Discord permission gate (Manage Channels for channel-bind, Manage Guild for server-bind) + server-side allowlist override.
- `/edit type:permissions` modal includes `$view`, `$edit`, `$use`, `$delete`, and blacklist fields.
- Role IDs use a `role:` prefix in permission lists to distinguish from user IDs.
- Zero selections on view/edit/use stores `"@everyone"`; zero on blacklist/delete stores `null`.
- Confused-deputy prevention: server-bound entities skip channels whose owner lacks Discord VIEW_CHANNEL + READ_MESSAGE_HISTORY.
- `/sendnote` permission: default gate is MANAGE_MESSAGES (8192); `/config sendnote` allowlist overrides this. `canUserSendNoteInLocation` returns `null` when no allowlist is set (caller checks Discord permissions) or `true`/`false` when an allowlist is configured.
- `/sendas entity:<name> content:<text>` sends a message as a named entity (requires both edit AND use permission) or as `@system` (requires MANAGE_WEBHOOKS). Entity path sends via webhook + stores in DB; `@system` path stores with `is_system: true`.
- `/purge` operates on both webhook messages and system notes; system note deletion is DB-only (no Discord API call).
