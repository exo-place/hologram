# Introduction

Hologram is a Discord bot designed for roleplay with intelligent context and memory management. Built on Bun and Discordeno, it provides a SillyTavern-inspired experience directly in Discord.

## Key Features

- **Smart Context Assembly** - Automatically manages what goes into the LLM prompt based on token budgets and priorities
- **Chronicle Memory** - Persistent, searchable memories with perspective awareness (who knows what)
- **Scene System** - Pause and resume RP sessions with full state preservation
- **Multi-Character** - Voice multiple AI characters using webhooks or tagged output
- **World State** - Locations, time, weather, and configurable world rules
- **User Proxying** - PluralKit-style character switching for players

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Bun |
| Discord | Discordeno |
| LLM | AI SDK (provider-agnostic) |
| Database | bun:sqlite |
| Vectors | sqlite-vec |

## Quick Start

1. Clone the repository
2. Copy `.env.example` to `.env` and configure
3. Run `bun install`
4. Run `bun run dev`

See the [Installation](/guide/installation) guide for detailed setup instructions.
