---
title: Core Concepts
---

# Core Concepts

This page explains the mental model behind Hologram. Read it once and the rest of the docs will make sense.

## Everything Is an Entity

Hologram has one fundamental building block: the **entity**. Characters, locations, items, factions, help topics — all entities. There is no special "character" type or "location" type. The difference between a sword and a tavern-keeper emerges entirely from the facts you attach to them.

```
Entity: Aria           → a character (because her facts say so)
Entity: The Broken Axe → a tavern (because her facts say so)
Entity: Sunstone Gem   → an item (because its facts say so)
```

You create entities with `/create`, view them with `/view`, and edit them with `/edit`.

## Facts Shape Behavior

Facts are freeform lines of text attached to an entity. When the bot responds, the entity's facts become its system prompt — the AI reads them to understand who or what the entity is.

```
is a traveling merchant with silver hair
speaks cautiously around strangers
carries a worn leather satchel
is currently in a small border town
```

Facts are plain prose. There's no required format, no fixed fields. Write what the AI needs to know.

Some facts carry special meaning because of patterns the system recognizes. For example, the macro `{{entity:12}}` in a fact expands to the name of entity 12 at runtime — useful for expressing relationships like `is in {{entity:12}}` when you want the location name to update automatically if the entity is renamed. See [Facts Reference](/reference/facts) for the full list of recognized patterns.

### Facts Are Mutable

The AI can modify facts through tool calls during a conversation. If Aria learns something, she might add a fact: `met a traveler named Sven seeking rare gems`. This is how memory accumulates between sessions — not through conversation history alone, but through persistent facts.

## Conditions — `$if`

Any fact line can be made conditional with a `$if` prefix:

```
$if mentioned: $respond
$if content.match(/potion|health/i): has a store of healing potions worth discussing
$if random() < 0.05: is in a particularly talkative mood
```

The condition is a JavaScript expression evaluated against the current message context. Variables include `mentioned`, `content`, `response_ms`, `random()`, and many more. The fact after the colon is only included in the prompt (or only has its directive effect) when the condition is true.

This is how you control when an entity responds, what it reveals, and how it behaves in different situations — all from within the facts list, without touching configuration files.

See [Expressions Reference](/reference/directives) for the full variable and directive list.

## Bindings — Connecting Entities to Discord

An entity on its own does nothing. A **binding** is what connects an entity to a Discord channel, server, or user.

### Channel binding

```
/bind channel Aria
```

Aria receives and responds to messages in this channel. Channel bindings take priority over server-wide bindings.

### Server binding

```
/bind server Narrator
```

The Narrator entity responds across every channel in the server, except channels that have their own binding.

### User binding (persona)

```
/bind me Traveler
```

Your messages are attributed to the Traveler entity. The AI sees you as that character. Scoped versions exist: `Me (this channel)`, `Me (this server)`, `Me (global)`. See [Personas](/guide/personas).

### Unbinding

```
/unbind channel Aria
```

Removes the binding. The entity still exists; it just no longer responds in that channel.

### Permissions

Binding requires permission at two levels: the entity must allow you to bind it (entity-side `$edit` permission), and the server/channel must allow binding operations (`/config` sets this, Manage Channels required). By default, only the entity owner can bind it, and anyone can initiate binds in any channel.

## The Message Pipeline

When a message arrives in a bound channel:

1. **Channel lookup** — find the entity bound to this channel (channel-scoped wins over server-scoped).
2. **Fact evaluation** — evaluate all the entity's facts, resolving `$if` conditions against the current message context. This produces a filtered list of active facts and determines whether the entity should respond at all (`$respond`).
3. **Prompt assembly** — active facts, recent message history, and any memories are assembled into a prompt.
4. **LLM call** — the prompt is sent to the configured language model.
5. **Tool calls** — the LLM can call tools during its response: `add_fact`, `update_fact`, `remove_fact` to update the entity's facts in real time.
6. **Response** — the final text is sent to Discord, as a webhook message (using the entity's avatar if set) or a regular bot message.

The entity only responds if fact evaluation produces a `$respond` directive. No `$respond` = silence, even if the bot is bound to the channel. This is intentional — you control response triggers through facts.

## What Comes Next

Once you have the mental model, the rest is details:

- **[Getting Started](/guide/getting-started)** — set up your first character step by step
- **[Personas](/guide/personas)** — speak as a character yourself
- **[Multi-Character Channels](/guide/multi-character)** — run multiple entities in one channel
- **[Directives Reference](/reference/directives)** — every `$if`, `$respond`, `$stream`, `$model`, and other directive
- **[Facts Reference](/reference/facts)** — macros, patterns, and what's available in fact text
- **[Commands Reference](/reference/commands)** — every slash command with its options
