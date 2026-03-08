# src/bot/commands/

Slash command definitions and interaction routing. All user-facing Discord commands live here.

## Key Files

- `commands.ts` — The 12 slash commands: `/create`, `/view`, `/edit`, `/delete`, `/transfer`, `/bind`, `/unbind`, `/config`, `/debug`, `/trigger`, `/forget`. Each command is registered via `registerCommand()` from `index.ts`. Permission checks (view/edit/use/blacklist) are enforced inline. The `/edit` command handles multiple `type:` variants (facts, config, system prompt, advanced, permissions) using Discord modals and select menus.
- `index.ts` — Command registry and interaction router. Defines `CommandContext`, `CommandHandler`, `registerCommand`, and `registerModalHandler`. `handleInteraction` dispatches incoming Discord interactions to the correct handler. Also contains autocomplete logic (entity search filtered by ownership and permissions) and helper functions `respond`, `respondWithModal`, `respondWithV2Modal`.
- `helpers.ts` — Pure, Discord-free helper functions extracted for unit testability: `chunkContent` (split long text at newlines), `elideText` (keep head+tail within char limit), `buildDefaultValues` (modal pre-fill from current config), `buildEntries` (format config display text).
- `help.ts` — `ensureHelpEntities`: creates or refreshes the built-in help system entities (`help`, `help:start`, `help:commands`, etc.) on startup. Help is implemented as regular entities with facts, viewable via `/view help`.

## Notes

- Two-layer permission model: entity-side (`$view`, `$edit`, `$use`) + server-side allowlists in `discord_config` (channel/guild scope).
- Role IDs use a `role:` prefix in permission lists to distinguish from user IDs.
- Zero selections on view/edit/use stores `"@everyone"`; zero on blacklist stores `null` (no blacklist).
- Admin (Manage Channels) can bypass entity bind/unbind restrictions.
