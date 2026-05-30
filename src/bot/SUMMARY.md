# src/bot/

Discord interface layer. Owns the Discordeno bot instance, message ingestion pipeline, webhook delivery, and slash command dispatch. This is the boundary between Discord events and the rest of the system.

## Key Files

- `client.ts` — Creates and configures the Discordeno bot. Handles `MESSAGE_CREATE` and `MESSAGE_UPDATE` events: resolves bound entities, evaluates facts, decides whether to respond, calls `handleMessage` or `handleMessageStreaming`, and sends the result via `sendResponse`. Also manages startup catch-up (backfilling missed messages), response-chain depth limiting, self-message filtering, and user onboarding DMs. Exports the `bot` instance (used as the canonical `Bot` type via `typeof bot`).
- `channel-queue.ts` — Per-channel serialization queue (`runOnChannel`). Ensures `MESSAGE_CREATE` handlers for the same channel run one at a time so each entity's context build sees the prior entity's webhook reply in message history. Used by both `client.ts` and `src/api/chat-adapter.ts`. Hard timeout (120 s) prevents a wedged LLM call from locking a channel forever.
- `client-serialization.ts` — Pure serialization utilities extracted from `client.ts`: `buildMsgDataAndContent`, `channelTypeString`, `guildNsfwLevelString`, `serializeComponents`, `serializeEmbed`, `serializeDiscordEmbed`. Also exports the `BotMessage` type (element type of `bot.helpers.getMessages` return). `buildMsgDataAndContent` persists mention metadata (`mentions`, `mention_roles`, `mention_everyone`, `mention_channels`) and `referenced_message.author_id` (for reply-ping detection) into `messages.data`.
- `webhooks.ts` — Webhook creation, caching, and message delivery. `executeWebhook` posts entity responses as webhook messages (with custom avatar and name). Handles thread channel resolution (threads must use the parent channel's webhook with a `thread_id` parameter). `editWebhookMessage` updates existing messages. `setBot` avoids circular imports by receiving the bot reference at startup.
- `mute-filter.ts` — Entity mute gating. `filterMutedEntities(entities, channelId, guildId)` checks channel/guild kill-switches first, then per-owner and per-entity mutes. Called before fact evaluation to avoid wasted LLM work. Returns `{ active, muted }`.
- `rate-limit.ts` — Sliding-window rate-limit enforcement. `checkRateLimits(channelId, guildId, entities)` evaluates three limit scopes (per-entity, per-owner, per-channel) and returns `{ allow, denied, ownerIds }`. Denied entities are dropped from the response set; `mod_events` rows are recorded. `shouldWarnRateLimit` provides TTL-based dedup (5 min) so the owner gets at most 1 DM per (entity, scope) per window.
- `duration.ts` — Shared duration parsing utilities. `parseDuration(input)` converts human duration strings (`30s`, `1h30m`, `forever`, etc.) to SQLite UTC timestamps or null (indefinite). `discordRelative(expiresAt)` converts a stored SQLite UTC timestamp to a Discord `<t:UNIX:R>` relative mention. `discordTimestamp` returns the full+relative pair. Used by `/mute` and re-exported via `cmd-admin.ts`.
- `commands/` — Slash command definitions and interaction routing (see `commands/SUMMARY.md`). Autocomplete uses entity `nickname` for disambiguation display.

## Notes

- `MESSAGE_UPDATE` handler is overridden to also process non-edit embed-only updates (URL previews, late bot embeds), which Discordeno's default handler silently drops.
- Guild-scoped (server-bound) entities are suppressed in private threads (channel type 12). A `/bind` on the thread itself is the explicit opt-in path.
- Self-message detection uses entity ID comparison, not name comparison, to avoid false positives.
- Response-chain depth is tracked per-channel and reset when a human message arrives.
- `entity_events` are recorded after every successful webhook emit (via `recordEntityEvent`) to power the sliding-window rate-limit queries.
