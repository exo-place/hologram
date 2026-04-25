# Commands Reference

## Entity Management

### `/create`

Create a new entity.

```
/create [name]
```

**Examples:**
```
/create Aria           # Create entity named Aria
/create                # Opens modal for name and facts
```

---

### `/view`

View an entity and its facts or memories.

```
/view <entity> [type]
```

The optional `type` parameter controls what is shown:

| Value | Shows |
|-------|-------|
| `All (facts + memories)` | Facts and memories (default) |
| `Facts only` | Facts only |
| `Memories only` | Memories only |

**Examples:**
```
/view Aria             # View facts and memories
/view help             # View help entity
/view help:triggers    # View triggers help
```

---

### `/edit`

Edit an entity's facts, memories, config, or template.

```
/edit <entity> [type]
```

The optional `type` parameter selects what to edit:

| Value | Opens |
|-------|-------|
| `Both` | Facts and memories combined (default) |
| `Facts only` | Facts only (more space, up to 4 fields) |
| `Memories only` | Memories only |
| `Template` | Nunjucks template (system prompt formatting) |
| `System Prompt` | Per-entity system instructions |
| `Config` | Model, context, stream, avatar, memory settings |
| `Advanced` | Thinking level |
| `Permissions` | View, edit, use, and blacklist permissions |

**Examples:**
```
/edit Aria                        # Edit facts and memories
/edit Aria type:Facts only        # Edit only facts
/edit Aria type:Config            # Edit model and settings
/edit Aria type:Permissions       # Edit permissions
/edit Aria type:Template          # Edit Nunjucks template
/edit Aria type:System Prompt     # Edit system instructions
```

---

### `/delete`

Delete an entity you own.

```
/delete <entity>
```

Only the owner can delete an entity.

**Examples:**
```
/delete Aria           # Delete Aria
```

---

### `/transfer`

Transfer entity ownership to another user.

```
/transfer <entity> <user>
```

Only the current owner can transfer an entity.

**Examples:**
```
/transfer Aria @username  # Transfer Aria to another user
```

---

## Bindings

### `/bind`

Bind a Discord channel, server, or yourself to an entity.

```
/bind <target> <entity>
```

**Targets:**
- `This channel` - Entity responds in this channel
- `This server` - Entity responds in all channels of this server
- `Me (this channel)` - Speak as entity in this channel only
- `Me (this server)` - Speak as entity server-wide
- `Me (global)` - Speak as entity everywhere

**Examples:**
```
/bind "This channel" Aria           # Aria responds here
/bind "This server" Narrator        # Narrator responds server-wide
/bind "Me (this channel)" Traveler  # Speak as Traveler here
/bind "Me (this server)" Knight     # Speak as Knight server-wide
```

---

### `/unbind`

Remove an entity binding from a channel, server, or yourself.

```
/unbind <target> <entity>
```

**Targets:**
- `This channel` - Unbind from this channel
- `This server` - Unbind from this server
- `Me (this channel)` - Remove channel-specific persona
- `Me (this server)` - Remove server-wide persona
- `Me (global)` - Remove global persona

**Examples:**
```
/unbind "This channel" Aria           # Remove Aria from this channel
/unbind "Me (this channel)" Traveler  # Stop speaking as Traveler here
/unbind "Me (this server)" Knight     # Remove server-wide persona
```

---

## Server Configuration

### `/config`

Configure bind and persona permissions for a channel or server. Requires **Manage Channels**.

```
/config <scope>
```

**Scopes:**
- `This channel` - Configure permissions for the current channel
- `This server` - Configure permissions server-wide

Opens a modal with three permission lists:

| Field | Controls |
|-------|----------|
| Bind access | Who can bind entities here (blank = everyone) |
| Persona access | Who can use personas here (blank = everyone) |
| Blacklist | Blocked from all binding operations |

Each field accepts users and roles. Clearing all fields removes the configuration (everyone can bind).

---

### `/config-chain`

Set or clear the response chain limit for a channel or server. Requires **Manage Webhooks**.

```
/config-chain <scope>
```

**Scopes:**
- `This channel` - Override for the current channel
- `This server` - Override server-wide

Opens a modal with a single field: enter a number from 1–20 to cap the self-response chain, or leave blank to inherit the server/global default (`MAX_RESPONSE_CHAIN` env var, default 3).

The channel-level override takes precedence over the server-level override, which takes precedence over the environment variable.

---

## Status and Debugging

### `/debug`

View current channel state or debug information.

```
/debug [subcommand]
```

| Subcommand | Description |
|------------|-------------|
| `status` (default) | Channel bindings, your persona, unread message count |
| `prompt [entity]` | System prompt that would be sent to the LLM |
| `context [entity]` | Message context that would be sent to the LLM |
| `rag [entity] [query]` | Embedding status and RAG retrieval test results |

For `prompt`, `context`, and `rag`, `entity` defaults to the channel-bound entity.

**Examples:**
```
/debug                    # Channel state
/debug status             # Same as above
/debug prompt             # System prompt for bound entity
/debug prompt Aria        # System prompt for Aria
/debug context Aria       # Message context for Aria
/debug rag Aria "silver"  # Test RAG retrieval with query
```

---

## Trigger

### `/trigger`

Manually trigger an entity to respond in the current channel. Bypasses the normal response logic (`$respond` / `$if`) — the entity will always respond.

```
/trigger <entity> [verb]
```

Respects `$use` and `$blacklist` permissions — you must be allowed to trigger the entity.

**With a verb (entity-to-entity interaction):**

The optional `verb` parameter sets `interaction_type` in the triggered entity's context, letting it react based on how it was interacted with. Requires you to have a persona bound (via `/bind`) — the interaction is attributed to your character, not to you directly.

```
/trigger HealthPotion drink    # Your persona drinks the potion
/trigger StoneDoor open        # Your persona opens the door
```

The triggered entity can then use `$if interaction_type == "drink"` to only respond to that specific interaction.

**Examples:**
```
/trigger Aria                  # Force Aria to respond now
/trigger HealthPotion drink    # Trigger HealthPotion with interaction_type "drink" (requires persona)
```

---

## History

### `/forget`

Exclude all messages before this moment from the LLM context. Useful for resetting the "memory" of a conversation without deleting any messages.

```
/forget
```

Messages are not deleted — they remain in the database. They are simply excluded from the context window going forward.

---

## Help

Help is an entity! View it with `/view`:

```
/view help              # Overview
/view help:start        # Getting started guide
/view help:commands     # Command reference
/view help:expressions  # Response control ($if)
/view help:patterns     # Common expression patterns
/view help:facts        # Fact patterns
/view help:bindings     # Binding system
/view help:permissions  # Entity permissions
/view help:models       # LLM configuration
```
