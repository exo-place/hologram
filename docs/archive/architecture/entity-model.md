# Entity Model: First Principles

## Goals

**Parity with SillyTavern**: Character chat with memory. Works out of the box. No setup friction.

**Parity with TiTS**: Adult adventure with transformation, inventory, locations. World simulation that actually works.

**Parity with just some rando on Discord**: Casual conversation. Mention the bot, it responds. Zero configuration.

**Natural format**: The model responds in an appropriate format based on context, not forced structure. Minimal prompting. No rigid templates.

- Casual chat → casual response
- Character RP → character voice
- Multi-char scene → natural prose with multiple characters

Format emerges from context, not from instructions.

---

## Channels & Discord Mapping

Discord IDs (channels, users, guilds) map to entities.

```
discord_entity_map
├── channel_id → entity_id (or null)
├── user_id → entity_id (or null)
└── guild_id → entity_id (or null)
```

### Location binding via facts

No special config. Just facts.

```
Entity: "#rp-main" (Discord channel)
Facts:
- "is in [entity:tavern]"

Entity: "Aria"
Facts:
- "is in [entity:tavern]"
```

If channel has location fact → use it.
If character has location fact → use it.
If neither → no location.

### Emergent behaviors

**Channel = Location**: Channel entity and location entity are the same thing.

**Changeable location**: Update the fact. `move_entity(channel, new_location)`

**Multiple channels → same location**: Multiple channel entities with facts pointing to same location.

**No location**: No fact, no location. Bot just responds.

All "modes" emerge from facts, not config enums.

**Note:** DMs are just channels. Same model applies.

### Cross-Channel Sync

When multiple channels bind to the same location, sync behavior is configurable via facts on the channel:

```
Entity: "#rp-1"
Facts:
- "is in [entity:tavern]"
- "sync_facts: true"
- "sync_messages: false"
- "notify_enter: true"
- "notify_exit: true"
- "notify_events: false"
```

Each behavior is a boolean, independently toggleable:

| Fact | Effect |
|------|--------|
| sync_facts | Fact changes propagate to other channels at same location |
| sync_messages | Messages bridged across channels |
| notify_enter | "X entered" appears in other channels |
| notify_exit | "X left" appears in other channels |
| notify_events | Other events propagate |

The binding itself is just a fact ("is in [entity:x]"). Sync settings are also facts on the channel. No separate binding entity for now.

---

## User Personas

Discord users map to persona entities. Mapping is scoped:

```
discord_entity_map
├── (user_id) → default persona entity
├── (user_id, guild_id) → guild-specific persona
├── (user_id, channel_id) → channel-specific persona
```

Resolution order (most specific wins):
1. Channel-specific → use that
2. Guild-specific → use that
3. Default → use that
4. None → Discord username as-is

```
User 123's mappings:
- default → entity:jake-casual
- guild:456 → entity:jake-the-ranger
- channel:789 → entity:sir-reginald
```

No separate persona/proxy system. Just scoped entity mappings.

---

## Permissions

### Principles

- **Create**: Anyone can create. Without write perms, no destruction possible.
- **View**: Private by default. Don't force FOSS philosophy - users own their creations.
- **Edit**: Owner + explicitly granted users/roles. Owner has implicit view/edit.
- **Delete**: Owner only.
- **Admins**: Can ban users from their server/channel. Cannot forcibly edit others' entities.

### As facts

```
Entity: "Aria"
Facts:
- "owned by [entity:user-123]"
- "viewable by [entity:user-456]"
- "editable by [entity:role-gm]"
```

Owner is implicit view+edit. Others need explicit grants.

### Admin scope

Discord admins control access to their space, not to entities:
- Can ban user from server/channel
- Can remove entity from being used in their space
- Cannot edit/delete entities they don't own

Ownership respected. Moderation is about space, not content.

---

## Introspection

**View entity**: See facts on an entity (if permissions allow).

**View channel state**: See current state of the channel - bound location, entities present, active personas.

Simple. No complex debug commands.

---

## Command Set

Minimal verbs with shortcuts. Autocomplete does the heavy lifting.

### Core Commands

| Command | Alias | Purpose |
|---------|-------|---------|
| `/create <type>` | `/c` | Create entity. Types: `c` (character), `l` (location), `i` (item), or custom template |
| `/view <entity>` | `/v` | View entity and its facts |
| `/edit <entity>` | `/e` | Edit facts on entity |
| `/delete <entity>` | `/d` | Delete entity (owner only) |
| `/bind` | `/b` | Map Discord channel/user to entity |
| `/status` | `/s` | View current channel state |
| `/help` | `/h` | Help |

### Type Aliases

Short forms are aliases, full names always work:

| Full | Aliases |
|------|---------|
| `character` | `char`, `c` |
| `location` | `loc`, `l` |
| `item` | `i` |

### Examples

```
/create character       → create character (full)
/create char            → create character
/c c                    → create character (shortest)
/c loc                  → create location
/create mytemplate      → create from custom template
/v Aria                 → view Aria's facts
/e Aria                 → edit Aria's facts
/bind #tavern tavern    → bind channel to location entity
/s                      → what's going on in this channel
```

### Autocomplete

- Entity names
- Types/templates
- Fact keys
- Users for permissions

### Custom Templates

Users can define templates for common entity patterns. `/c mytemplate` uses their template instead of built-in types.

### Batch Edit with Prefill

`/e <entity>` opens a modal with current facts prefilled:

```
┌─────────────────────────────────┐
│ Edit: Aria                      │
├─────────────────────────────────┤
│ Facts (one per line):           │
│ ┌─────────────────────────────┐ │
│ │ has pointed ears            │ │
│ │ is an elf                   │ │
│ │ is in [entity:tavern]       │ │
│ │ portrait: https://...       │ │
│ └─────────────────────────────┘ │
│                    [Save]       │
└─────────────────────────────────┘
```

Edit in place. Add/remove lines. Discord modals support prefilled TextInput values.

---

## Images

Images are just facts.

```
Entity: "Aria"
Facts:
- "portrait: https://..."
- "expression_happy: https://..."
- "expression_angry: https://..."
- "fullbody: https://..."
```

Multiple images supported (portrait, expressions, scenes, etc.). No special image system - just facts with URLs.

---

### What's Gone

No separate commands for:
- `/character`, `/location`, `/item` → all `/create`
- `/scene`, `/session`, `/world` → just entities and bindings
- `/memory`, `/chronicle`, `/notes` → just facts
- `/inventory`, `/equipment` → facts on entities
- `/config` → facts on channel/guild entities

28 commands → 7 core verbs.

---

## Core Premise

There is no fundamental distinction between character, item, location, or world. These are all **entities**. The differences between them are emergent from their **attached facts**, not from their type.

---

## Entities

An entity is a thing that exists. That's it.

```
Entity
├── id
├── name
└── (that's it)
```

What makes an entity a "character" vs an "item" vs a "location" is not a type field. It's the facts attached to it.

---

## Facts

A fact is a piece of information attached to an entity.

```
Fact
├── id
├── entity_id (what this fact is about)
├── content (the fact itself)
└── ...
```

### Examples

**A character:**
```
Entity: "Aria"
Facts:
- "has pointed ears"
- "is an elf"
- "is currently in [entity:tavern]"
- "remembers meeting [entity:player] yesterday"
- "is carrying [entity:sword]"
```

**A location:**
```
Entity: "The Rusty Anchor"
Facts:
- "is a tavern"
- "has wooden floors and a low ceiling"
- "contains [entity:aria]"
- "is located in [entity:portside-district]"
```

**An item:**
```
Entity: "Grandfather's Sword"
Facts:
- "is a longsword"
- "deals 1d6+2 slashing damage"
- "is held by [entity:aria]"
- "was forged by [entity:master-owen]"
```

**A world:**
```
Entity: "Eldoria"
Facts:
- "is a fantasy world"
- "magic is common"
- "contains [entity:portside-district]"
```

---

## Observations

### 1. Relationships are facts

"Aria is in the tavern" is a fact on Aria. Or on the tavern. Or both. Relationships between entities are just facts that reference other entities.

### 2. Memory is facts

A character's "memory" is just facts attached to that character. "Remembers meeting the player" is a fact.

### 3. Descriptions are facts

A location's "description" is just facts. "Has wooden floors" is a fact.

### 4. Types are optional convenience

We might keep a `type` hint for UI/query convenience, but it's not architecturally meaningful. An entity tagged "character" is just an entity that happens to have character-like facts.

### 5. Hierarchy is facts

"The tavern is in the portside district" is a fact. "The portside district is in the city" is a fact. Hierarchy emerges from containment facts.

---

## Decisions

### Fact ownership

**Facts belong to one entity.** A fact can reference other entities, but it lives on one entity.

"Aria is in the tavern" → fact on Aria, references tavern entity.

### Fact visibility

**Facts are public by default.** They're context injections, not secrets.

Secrets are a separate problem to solve later.

### Fact temporality

**Facts are modifiable by LLM decision.** The LLM can add, update, or remove facts through a mechanism (tool call).

No versioning. Just current state.

### Context building

**Wrap in XML tags, join by newline.**

```xml
<facts entity="Aria">
has pointed ears
is an elf
is currently in The Rusty Anchor
remembers meeting the player yesterday
</facts>
```

Simple. No markdown. No headers.

---

## Chat Model

Chat is just the transport. It's a hack, not a core concept.

### Message Roles (SillyTavern convention)

| Role | Purpose |
|------|---------|
| `system` | Constructed context (entity facts, world state, etc.) |
| `user` | External input - all incoming messages merged into one block, prefixed by persona |
| `model` | LLM responses ONLY. Nothing else goes here. |

### Example

```
system:
<facts entity="Aria">
has pointed ears
is an elf
works as a barmaid at The Rusty Anchor
</facts>
<facts entity="The Rusty Anchor">
is a tavern in the portside district
has wooden floors and a low ceiling
</facts>

user:
Jake: *walks in and sits at the bar* What's good here?
Sarah: *follows behind, looking around nervously*

model:
*Aria looks up from polishing a glass* Well, the fish stew's fresh today. *notices Sarah* First time in Portside?
```

### Notes

- Multiple Discord users' messages merge into one `user` block
- Each message prefixed with persona name
- No system-injected markdown
- The model responds as the character(s)

---

## Context Selection

Not all entities go into context. Only what's relevant:

### What goes in:

1. **Entities in the current location**
   - Characters present
   - Items in the location
   - The location itself

2. **Per-character:**
   - Their own facts
   - Their inventory (optional)
   - What they know (facts they've learned about other entities)

### What doesn't go in:

- Entities in other locations
- Facts about things not present
- (Retrieved via semantic search only if relevant)

---

## Multi-Character Responses

**Default: Combined narration.** The model writes a single response where multiple characters can speak/act naturally.

```
*Aria slides a drink across the bar while Tom sweeps near the door.*
"Fresh catch today," she says. Tom grunts in agreement without looking up.
```

**Not forced structure.** No `[Aria]: ... [Tom]: ...` unless the format explicitly requires it.

Why: Less turn-based = less forced structure = more natural prose.

Tags only if config/format explicitly requests tagged output.

---

## Body & Inventory

Body parts are inventory slots. Each slot can have its own slots. They're also facts.

### Structure

```
Entity: "Aria"
├── body (from preset)
│   ├── head
│   │   ├── facts: ["has pointed ears", "has green eyes"]
│   │   └── slots: [earrings, headwear]
│   ├── torso
│   │   ├── facts: ["is slender"]
│   │   └── slots: [armor, shirt, necklace]
│   ├── left_hand
│   │   ├── facts: []
│   │   └── slots: [held_item, ring]
│   │       └── held_item: [entity:torch]
│   ├── right_hand
│   │   ├── facts: []
│   │   └── slots: [held_item, ring]
│   │       └── held_item: [entity:sword]
│   └── ...
└── inventory (non-body storage)
    └── [entity:backpack]
        └── contains: [entity:potion, entity:rope]
```

### Body Preset

A template defining what body parts an entity has. Humanoid, quadruped, amorphous, etc.

### Transformation

Changing body = changing facts on body parts OR changing the body preset itself.

- "Aria's ears become rounded" → update fact on head
- "Aria grows a tail" → add new body part from different preset
- "Aria transforms into a wolf" → swap to quadruped preset

### Items

Items are just entities. They can be:
- In a body slot ("held by left_hand")
- In another entity's inventory ("inside backpack")
- In a location ("on the floor of the tavern")

Containment is a fact: "contains [entity:x]" or "held by [entity:y]"

---

## Locations & Hierarchy

Locations are entities. Hierarchy is facts.

### Containment (bidirectional)

Both directions needed for efficient queries:

```
Entity: "The Rusty Anchor"
Facts:
- "is a tavern"
- "is in [entity:portside-district]"

Entity: "Portside District"
Facts:
- "is a district"
- "is in [entity:port-city]"
- "contains [entity:rusty-anchor]"
- "contains [entity:fish-market]"
```

### Connections (asymmetric)

Connections are facts. Not necessarily bidirectional.

```
Entity: "Cliff Edge"
Facts:
- "leads to [entity:ravine-bottom]"  // one way - you fall

Entity: "Ravine Bottom"
Facts:
- "leads to [entity:cave-entrance]"
- // no way back up to cliff edge

Entity: "Jump Gate Alpha"
Facts:
- "leads to [entity:jump-gate-beta]"  // one way wormhole
```

### Why asymmetric?

- One-way portals
- Jump gates
- Holes you can't climb out of
- Locked doors (from one side)
- Plot devices

Connection facts describe what you can reach FROM here, not what can reach you.

---

## Fact Modification

**Tool calls.** Models are trained on them.

### Tools

```
add_fact(entity_id, content)
update_fact(fact_id, content)
remove_fact(fact_id)
move_entity(entity_id, to_entity_id)  // containment shorthand
```

### Example

User: *Aria picks up the torch from the wall*

Model response + tool calls:
```
<tool_call>move_entity(torch, aria.left_hand)</tool_call>
<tool_call>add_fact(aria, "is holding a lit torch")</tool_call>

*Aria lifts the torch from its bracket, the flame casting dancing shadows across her face.*
```

### Notes

- Tools fire during response generation, not after
- Model decides what facts change
- Simple verbs: add, update, remove, move
- No complex extraction pipeline needed

---

## Time (Optional Subsystem)

Two separate concepts:

### 1. In-World Time (fiction)

For persistent RP worlds with their own timeline.

```
Entity: "World Clock"
Facts:
- "hour is 7"
- "day is 3"
- "season is autumn"
- "sun is rising"
```

- Optional, off by default
- LLM modifies via tool calls ("advance to evening")
- Adds temporal context to fiction

### 2. IRL Time (discord-native)

For casual interactions without a fictional world.

- Messages labeled with real timestamps
- Model knows "this was sent 2 hours ago" or "we last talked 3 days ago"
- Natural temporal awareness for conversation continuity

```xml
<messages>
<message from="Jake" time="2 hours ago">hey, did you figure out that thing?</message>
<message from="Aria" time="2 hours ago">Still working on it</message>
<message from="Jake" time="now">any progress?</message>
</messages>
```

### Why both?

- In-world: "It's the third morning since we left the village"
- IRL: "You mentioned this yesterday, what happened?"

Different styles of RP. Neither is default. User chooses based on their use case.

---

## Combat, Stats, Dice

**Low priority.** These are compensating for proper text-based roleplay.

Good RP resolves conflict narratively, not mechanically. Dice and HP are crutches. If needed later, they layer on top - but they're not foundational.

---

## Open Questions

### Secrets

How do we handle information one entity knows but another doesn't? Deferred for now.

---

## Next Steps

<!-- Continue building out the model -->

