# Session Postmortem: 2026-01-26

## Summary

Multiple bugs were introduced and fixed in rapid succession due to insufficient understanding of the Discord API model, discordeno library specifics, and failure to consider the full application lifecycle (especially restart scenarios).

## Issues Encountered

### 1. Welcome Message Spam on Startup

**Problem:** Bot sent welcome messages to every guild on startup.

**Root Cause:** Assumed `guildCreate` only fires when the bot joins a new guild. In reality, Discord sends `guildCreate` for ALL guilds the bot is in when it connects.

**Fix:** Added `isInitialStartup` flag, set to false after a delay, to skip welcome messages during initial connection.

**Lesson:** Understand Discord gateway events fully. `guildCreate` is about the bot *seeing* a guild, not necessarily *joining* it.

---

### 2. Slash Command Filtering (Unnecessary)

**Problem:** Added `if (message.content.startsWith("/")) return;` to filter slash commands.

**Root Cause:** Misunderstanding of Discord's interaction model. Slash commands are **interactions**, not messages. They go through `interactionCreate`, never `messageCreate`.

**Fix:** Reverted the change after user correction.

**Lesson:** Slash commands and messages are completely separate event streams. Don't conflate them.

---

### 3. In-Memory State Lost on Reboot

**Problem:** After restart, bot showed typing but didn't respond. Multiple in-memory structures were lost:
- `activeChannels` (Set) - tracks enabled channels
- `channelWorldStates` (Map) - tracks world state per channel

**Root Cause:** Assumed the application would stay running. Didn't consider restart scenarios during feature implementation.

**Fixes:**
1. Channel enabled check now also considers "has active scene" (scenes are in DB)
2. `getWorldState()` now restores from active scene in DB on cache miss

**Lesson:** Any state that affects bot behavior must either be persisted to DB or reconstructable from persisted data. Always ask: "What happens after restart?"

---

### 4. Typing Indicator Triggers Unconditionally

**Problem:** Typing indicator fired for:
- All messages in all channels (not just enabled ones)
- The bot's own response messages

**Root Causes:**
1. Typing started before any "should we respond?" checks
2. `message.author.bot` check failed because `bot` property wasn't available in discordeno's desiredProperties

**Fixes:**
1. Only start typing if channel has an active scene
2. Check `message.author.id === botUserId` instead of relying on `author.bot`

**Lesson:**
- Understand library-specific property systems before relying on them
- Side effects (like typing) should only happen when you're committed to an action

---

### 5. Discordeno desiredProperties Misunderstanding

**Problem:** Tried to add `bot: true` to user properties, then tried nested author object - neither worked.

**Root Cause:** Assumed desiredProperties worked like a general property selector. It has a specific schema that doesn't include all User properties.

**Fix:** Removed invalid properties, relied on author ID comparison instead.

**Lesson:** Check library documentation/types for what's actually available, don't assume.

---

## Patterns of Failure

### 1. Not Thinking Through the Full Lifecycle
- Startup, normal operation, restart, error states
- What persists? What's reconstructable? What's lost?

### 2. Insufficient Discord API Understanding
- Events: `guildCreate`, `messageCreate`, `interactionCreate` have specific semantics
- Slash commands ≠ messages
- Gateway reconnection sends events for existing state

### 3. Library-Specific Assumptions
- Assumed discordeno properties work generically
- Didn't verify what's actually available in types

### 4. Implementing Before Understanding
- Made changes based on surface-level understanding
- User had to correct multiple times with increasing frustration

---

## Improvements for Future Sessions

### Before Implementing:
1. **Ask:** "What happens on restart?" for any stateful change
2. **Ask:** "Is this in-memory or persisted?" for any data access
3. **Verify:** Check library types/docs for available properties
4. **Understand:** The full event model before handling events

### During Implementation:
1. **One logical change at a time** - don't bundle unrelated fixes
2. **Test assumptions** - if unsure about API behavior, add logging first
3. **Consider side effects** - typing, messages, etc. should be intentional

### When Corrected:
1. **Stop and understand** why the correction was needed
2. **Don't double down** on misunderstandings
3. **Trace back** to the root cause, not just the symptom

---

## Technical Debt Created

None significant - all issues were caught and fixed in this session.

## Technical Debt Avoided

The fixes implemented proper persistence patterns:
- World state restores from DB
- Channel enabled status derived from scene existence
- Bot's own messages filtered by ID comparison

These patterns should be applied to any future in-memory state.
