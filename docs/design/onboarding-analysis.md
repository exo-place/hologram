# Onboarding Analysis

This document analyzes the current user onboarding experience and identifies barriers to entry for new users.

## Executive Summary

Hologram has powerful tools (wizards, presets, flexible config) but the journey from "bot joined server" to "RP working" requires external knowledge. Users must execute 4+ commands in the correct order with no in-app guidance.

**Current minimum viable setup:**
```
/world create <name>
/world init <world>
/character create <name>
/session enable
```

## Current State Analysis

### 1. First-Run Experience (Guild Join)

**Current:** No dedicated onboarding.

When a user adds the bot to a server:
- Nothing happens automatically
- No welcome message, no guided setup, no prompt
- Bot simply becomes available
- Users must discover commands themselves

The bot listens to `ready` and `messageCreate` events but has no `guildCreate` event handler.

### 2. Command Discovery

**Total commands:** 18 slash commands registered

| Category | Commands |
|----------|----------|
| Required | world, character, session |
| Optional | memory, chronicle, scene, location, time, status, roll, combat, relationship, faction, persona, proxy, config, build |

**Discovery issues:**
- No help/info command exists
- Slash command descriptions are terse
- No command hierarchy (all 18 are top-level)
- Flow not documented in Discord

### 3. Configuration

**Default behavior:** Complex out-of-the-box

Current `DEFAULT_CONFIG` enables:
- Chronicle (memory) - ON
- Scenes - ON
- Inventory - ON
- Locations - ON
- Time system - ON
- Relationships - ON
- Character state - OFF
- Dice - OFF

This is overwhelming for someone who just wants to chat with a character.

### 4. Error Handling

**Scenario:** User mentions bot with no setup

Behavior:
- If mentioned, bot responds even with no character set
- Falls back to generic: "You are a helpful assistant in a roleplay scenario."
- User gets response but no guidance about setup

**For commands without world:**
- Error: "No world initialized. Use '/world init' first."
- Clear but only appears when trying specific commands
- No preventive guidance earlier

### 5. Existing Helpers

**Wizards available:**
- `/build character` - Step-by-step with AI suggestions
- `/build world` - World creation wizard
- `/build location` - Location creation wizard
- `/build item` - Item creation wizard

**Config wizard:**
- `/config wizard` - Toggle features with buttons

**Problem:** These are powerful but:
- Not mentioned in first-run flow
- Require `/world init` first (chicken-and-egg)
- Could replace the 4-command minimum entirely

## User Journey Today

```
1. User invites bot to Discord
   -> Bot joins silently
   -> No guidance

2. User tries to message the bot
   -> Nothing happens (channel not enabled)
   -> OR user mentions the bot
   -> Bot responds as generic assistant
   -> User confused: "Where's my character?"

3. User discovers /character (somehow)
   -> Must also do /world create, /world init, /session enable
   -> Order matters but isn't documented
   -> Multiple attempts fail with errors

4. If user finds /build character
   -> Smooth wizard experience
   -> But discovery is hard
```

## Friction Points

| Barrier | Severity | Notes |
|---------|----------|-------|
| No welcome message on guild join | HIGH | Users don't know what to do |
| No command discovery | HIGH | Must find docs elsewhere |
| World + session setup hidden | HIGH | 4 separate commands required |
| Silent failure when channel disabled | MEDIUM | No error message |
| No guided flow | MEDIUM | Wizards not suggested |
| Complex defaults | MEDIUM | 7 systems enabled |
| Config wizard only works post-world | MEDIUM | Chicken-and-egg |
| No interactive setup on first mention | HIGH | Missed opportunity |

## Positive Elements

- Wizards are excellent UX (step-by-step, AI suggestions)
- Comprehensive commands for power users
- Flexible configuration system
- Clear error messages when they appear
- Presets/modes provide good defaults
- `/session debug` for troubleshooting

## Recommended Changes

See TODO.md for implementation plan covering:

1. **Guild join experience** - Welcome embed with quick start buttons
2. **Interactive /setup** - Guided flow that chains required steps
3. **Smart first-mention** - Offer setup when mentioned without config
4. **Minimal defaults** - Start simple, suggest features later
5. **Zero-config quick start** - Auto-create world + character on demand
6. **Progressive disclosure** - Suggest features based on usage milestones
7. **/help command** - In-Discord documentation and state overview
8. **Rich mode descriptions** - Explain presets in Discord UI

## Success Metrics

After implementation:
- Time from bot join to first RP response: < 30 seconds
- Commands required for basic usage: 0 (button click only)
- User confusion rate: Measurable via help command usage
- Feature discovery: Track preset/wizard usage over time
