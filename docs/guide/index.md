# Introduction

Hologram is a Discord bot designed for roleplay with intelligent context and memory management. Built on Bun and Discordeno, it provides a SillyTavern-inspired experience directly in Discord.

## Key Features

- **Zero-Config Start** - Just invite the bot and click Quick Setup
- **Smart Context Assembly** - Automatically manages what goes into the LLM prompt based on token budgets and priorities
- **Chronicle Memory** - Persistent, searchable memories with perspective awareness (who knows what)
- **Scene System** - Pause and resume RP sessions with full state preservation
- **Multi-Character** - Voice multiple AI characters using webhooks or tagged output
- **World State** - Locations, time, weather, and configurable world rules
- **User Proxying** - PluralKit-style character switching for players
- **Progressive Disclosure** - Starts simple, suggests features as you use them

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Bun |
| Discord | Discordeno |
| LLM | AI SDK (provider-agnostic) |
| Database | bun:sqlite |
| Vectors | sqlite-vec |

## Quick Start (Users)

When you add Hologram to your server, you'll see a welcome message with setup options:

1. **Quick Setup** - Click to create a world and enable responses instantly
2. **Choose Mode** - Pick a playstyle (minimal, SillyTavern, MUD, tabletop, etc.)

Or use slash commands:
- `/setup quick` - One-command setup with sensible defaults
- `/setup guided` - Step-by-step interactive setup
- `/build character` - Create a character with AI assistance

That's it! Start chatting or mention the bot to begin.

## Quick Start (Developers)

1. Clone the repository
2. Copy `.env.example` to `.env` and configure
3. Run `bun install`
4. Run `bun run dev`

See the [Installation](/guide/installation) guide for detailed setup instructions.

## Modes

Hologram supports different playstyles via modes:

| Mode | Description |
|------|-------------|
| **Minimal** | Simple chat with a character |
| **SillyTavern** | Character chat with memory and relationships |
| **MUD** | Text adventure with locations and inventory |
| **Survival** | Resource management with hunger, thirst, transformation |
| **Tabletop** | Dice rolling, combat, and turn-based play |
| **Parser** | Classic text adventure (Zork-style) |
| **Full** | All features enabled |

Use `/config preset <mode>` to switch modes anytime.

## Getting Help

- `/help` - Overview of current setup and available commands
- `/help <topic>` - Deep dive into specific features
- `/tips enable` - Get contextual suggestions as you use the bot
