# Architecture Rethink: January 2026

## Context

The current implementation has foundational issues. This document captures the ground-up rethink.

## What We Got Wrong

### The Chat Layer is Broken

We built simulation features (Layer 1-2) on an unstable chat foundation (Layer 0).

**Current execution model:**
```
message → 12 middleware stages → 7 formatters → budget allocation → LLM → 5 extractors → delivery
```

**What SillyTavern does:**
```
character card + chat history → LLM → response
```

### Scaffolding Issues

- System injects markdown headers (`## Persona`, `## Location`, etc.)
- Should: never inject markdown, only XML tags for structure
- Markdown only appears if user explicitly wrote it in definitions

### Memory is World-Level, Not Character-Level

- Chronicle/facts are tied to worlds and scenes
- Characters don't have their own memory stores
- SillyTavern: each character card has its own context

### Concept Overload

User-facing concepts: world, scene, session, channel, entity, character, location, etc.

Should be simpler.

## What We Got Right

- World simulation features (locations, time, inventory, combat) are conceptually fine
- They just need to layer properly on top of a working chat foundation

## Desired Architecture

```
Layer 0: Chat (character + memory + conversation) ← NEEDS REBUILD
Layer 1: Simulation (locations, time, inventory, etc.)
Layer 2: Mechanics (combat, dice, factions, etc.)
```

---

## Ground-Up Design (User Input)

<!-- User will explain what they want from the ground up -->

