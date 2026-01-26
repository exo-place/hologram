# UX Critique: 2026-01-26

## The Core Problem

The bot is built around **implementation concepts** (worlds, scenes, sessions, channels, entities) rather than **user goals** (I want to chat with a character).

## Concept Overload

A new user encounters:
- **World** - what is this? why do I need one?
- **Scene** - different from world? why?
- **Session** - different from scene? what?
- **Channel enabled** - another toggle?
- **Active character** - vs characters in scene?
- **Response modes** - 6 different modes?
- **Presets/Modes** - 8 different modes?

**User goal:** "I want to talk to an AI character"
**Current path:** /setup → /build character → (hope it works) → debug why it doesn't

## Command Explosion

25+ slash commands. Users don't read documentation. They see:
```
/build, /character, /chronicle, /combat, /config, /channel,
/debug, /export, /faction, /help, /imagine, /import, /keys,
/location, /memory, /notes, /persona, /proxy, /quota,
/relationship, /reroll, /roll, /scene, /session, /setup,
/status, /time, /tips, /world
```

This is terrifying. Which ones do I need? Most users need maybe 3-5.

## Silent Failures

The bot often does nothing with no feedback:
- No scene → silence
- No character → silence
- Wrong response mode → silence
- Channel not "enabled" → silence
- After reboot → silence (fixed now, but symptom of deeper issue)

Users don't know WHY nothing happened. They assume the bot is broken.

## Onboarding is Backwards

Current flow:
1. Bot joins guild
2. Sends message to general (wrong channel)
3. User runs /setup in their desired channel
4. Quick setup creates world + scene
5. User still needs to create/add character
6. User needs to understand scenes to add character
7. Maybe it works?

**Should be:**
1. Bot joins guild
2. User mentions bot in any channel
3. Bot: "Hi! Want me to be [character type]? Or describe who you want me to be:"
4. User types description
5. Bot creates everything internally, starts responding

Zero commands needed for basic usage.

## The "Power User" Trap

The bot is designed for power users who want:
- Multiple worlds
- Complex scene management
- Inventory systems
- Combat mechanics
- Chronicle/memory systems
- Custom response modes

But it forces ALL users through power-user complexity. There's no "just works" mode.

## Invisible State

Users can't see:
- What character is "active" (without /session status)
- What scene they're in (without /scene status)
- Why the bot isn't responding
- What the bot "knows" about the conversation

The /debug context command helps developers, not users.

## Terminology Confusion

- "Session" vs "Scene" - overlapping concepts
- "Enable" vs "Active" - both used for different things
- "World" vs "Guild" - 1:1 mapping, why two names?
- "Channel" is overloaded - Discord channel, but also "enabled channel"

## Response Mode Complexity

Six modes: `always`, `mention`, `trigger`, `chance`, `llm`, `combined`

Users want: "respond when I talk to you"

The default should just work. Advanced modes should be buried in config.

## Feature Flags Everywhere

Everything is a toggle:
- chronicle.enabled
- scenes.enabled
- inventory.enabled
- locations.enabled
- time.enabled
- relationships.enabled
- etc.

This creates 2^n possible configurations. Testing nightmare. User confusion.

---

## What Users Actually Want

### Casual User
"I want to chat with an AI character in my Discord"
- One command or zero commands to start
- Character responds when talked to
- Maybe remember some things

### Moderate User
"I want persistent RP with memory"
- Character remembers past conversations
- Maybe multiple characters
- Some world context

### Power User
"I want a full simulation"
- Locations, inventory, combat
- Multiple interacting characters
- Complex world state

---

## Proposed Simplifications

### 1. Zero-Command Start
- First mention in any channel → "Who should I be?"
- User describes → bot creates character + scene internally
- Everything else is optional enhancement

### 2. Collapse Concepts
- Remove "session enable" - if there's a scene, respond
- Remove "world" from user-facing - it's an internal grouping
- "Scene" becomes just "the current RP context"

### 3. Smart Defaults
- Default response mode: respond when mentioned OR when in active conversation
- No configuration needed for basic use
- Power features hidden until requested

### 4. Visible State
- Bot shows current character in status/activity
- Error messages explain WHY nothing happened
- "I'm not set up in this channel yet" vs silence

### 5. Command Tiers
**Essential (shown by default):**
- /character (simplified)
- /help

**Standard (shown in /help):**
- /scene, /memory, /config

**Advanced (hidden, documented):**
- Everything else

### 6. Guided Recovery
When bot can't respond, instead of silence:
- "I don't have a character here. Use /character create or describe who I should be"
- "I'm paused in this channel. Use /session enable to resume"

---

## Metrics We Should Track

- Time from bot join to first successful response
- Number of commands needed before first response
- Drop-off rate at each onboarding step
- "Silent failure" rate (message received, no response, no error)

---

---

## Prompt Construction Issues

### Over-Structured System Prompt

Current prompt is heavily sectioned:
```
# Character: Name
## Persona
...
## Current State
...
## Relationships
...
## Location: Place
...
## Current State
Time: Day 1, 9:00 AM (morning)
Weather: clear
...
## Visible Items:
...
## Exits:
...
```

This is **developer brain**, not **roleplay context**. The AI doesn't need markdown headers to understand context. It's wasting tokens on structure.

### Information Dump vs Narrative Context

We dump facts:
- "Time: Day 1, 9:00 AM (morning)"
- "Weather: clear"
- "Exits: Town Square, Forest Path"

Better as narrative:
- "It's a clear morning, around 9 AM. From here you could head to the town square or take the forest path."

### Redundant Sections

- "## Current State" appears under character AND scene
- Location description + exits + items + areas = 4 sections for one place
- Character persona + scenario + instructions + example dialogue = scattered identity

### Missing: What Matters Right Now

The prompt has everything EXCEPT:
- What just happened (recent context summary)
- What the user seems to want (intent)
- What's dramatically interesting (hooks)

We have: static world state
We need: dynamic narrative context

### Token Budget Misallocation

Spending tokens on:
- Verbose section headers
- Redundant state (time in scene AND world state)
- Every exit and item (even irrelevant ones)
- Full character personas for background NPCs

Not spending tokens on:
- Conversation summary when context is long
- Relevant memories (RAG often disabled)
- Recent event context

### Example Dialogue Handling

Changed to use real user/assistant turns (good), but:
- Still parsed from text format (fragile)
- No limit on how many examples
- Examples from ALL characters concatenated
- Takes up message history space

---

## Command Sprawl

### Current: 28 Commands

```
/build        /character    /channel      /chronicle    /combat
/config       /debug        /export       /faction      /help
/imagine      /import       /keys         /location     /memory
/notes        /persona      /proxy        /quota        /r
/relationship /reroll       /roll         /scene        /session
/setup        /status       /time         /tips         /world
```

### Problem: Discovery

Users see 28 commands in autocomplete. They don't know:
- Which are essential vs optional
- Which are related to each other
- What order to use them

### Problem: Overlap

- `/session enable` vs `/setup` - both "start the bot"
- `/session status` vs `/status` vs `/scene status` - three status commands
- `/character` vs `/build character` - two ways to create
- `/memory` vs `/chronicle` vs `/notes` - three memory systems
- `/config` vs `/config wizard` vs `/config preset` - config inception

### Problem: Namespace Pollution

Every feature gets a top-level command:
- `/faction` - rarely used
- `/combat` - niche use case
- `/quota` - admin only
- `/keys` - admin only
- `/tips` - meta

### Proposed: Consolidated Commands

**Tier 1: Always Visible (5)**
```
/start        - Begin/resume in this channel (replaces /setup, /session enable)
/character    - Manage characters (create, edit, list)
/help         - Get help
/config       - Change settings
/redo         - Regenerate last response (replaces /reroll)
```

**Tier 2: Standard Features (5)**
```
/scene        - Scene management
/memory       - Memory/chronicle (consolidate three systems)
/roll         - Dice (keep /r as alias)
/imagine      - Image generation
/export       - Export data
```

**Tier 3: Advanced/Admin (hidden from autocomplete, still work)**
```
/world, /location, /inventory, /combat, /faction, /relationship,
/time, /status, /proxy, /persona, /keys, /quota, /import, /debug,
/channel, /notes, /tips, /chronicle
```

### Implementation

Discord allows marking commands as hidden from autocomplete while still functional.
Or: subcommand consolidation (/admin keys, /admin quota, etc.)

---

## Next Steps

1. **Audit current onboarding** - map every step, find friction
2. **Implement zero-command start** - mention → character creation flow
3. **Add failure explanations** - never silent, always explain
4. **Collapse session/scene/enable** - one concept, one state
5. **Hide complexity** - power features opt-in, not opt-out
6. **Redesign prompt structure** - narrative over headers, relevant over complete
7. **Consolidate commands** - 5 essential, 5 standard, rest hidden
8. **Unify memory systems** - one /memory command, not three
