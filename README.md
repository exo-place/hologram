# Hologram

Discord RP bot with smart state/worldstate/memory/context management.

Inspired by SillyTavern but with proper knowledge graph, RAG, and tiered memory systems for sophisticated context assembly.

## Features

- **Freeform character system** - Not locked to CCv2 spec
- **World state** - Location, time, weather tracking
- **Inventory** - Items with consistent descriptions and stats
- **Knowledge graph** - Entities and relationships in SQLite
- **RAG** - Semantic search over memories via sqlite-vec
- **Tiered memory** - Ephemeral → Session → Persistent
- **Context assembly** - Smart selection of what fits in the LLM window
- **Multi-provider LLM** - AI SDK with `provider:model` spec
- **User App support** - Install personally, use in any DM or server

## Setup

### 1. Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** and name it
3. Copy the **Application ID** → `DISCORD_APP_ID`

#### Bot Setup
1. Go to **Bot** tab
2. Click **Reset Token** and copy it → `DISCORD_TOKEN`
3. Enable these **Privileged Gateway Intents**:
   - Message Content Intent

#### Installation Settings
1. Go to **Installation** tab
2. Enable both installation contexts:
   - **Guild Install** - For server installation
   - **User Install** - For personal installation (works in DMs)
3. For **Guild Install**, set scopes: `bot`, `applications.commands`
4. For **User Install**, set scopes: `applications.commands`

#### OAuth2 (for inviting)
1. Go to **OAuth2 → URL Generator**
2. Select scopes: `bot`, `applications.commands`
3. Select bot permissions: `Send Messages`, `Use Slash Commands`
4. Copy the generated URL to invite to a server

### 2. LLM API Key

Get an API key from your preferred provider:

| Provider | Get Key | Env Variable |
|----------|---------|--------------|
| Google AI | [aistudio.google.com](https://aistudio.google.com/apikey) | `GOOGLE_API_KEY` |
| Anthropic | [console.anthropic.com](https://console.anthropic.com/) | `ANTHROPIC_API_KEY` |
| OpenAI | [platform.openai.com](https://platform.openai.com/api-keys) | `OPENAI_API_KEY` |

### 3. Install & Run

```bash
# Install dependencies
bun install

# Set up environment
cp .env.example .env
# Edit .env with your tokens

# Run in development
bun run dev
```

## Environment Variables

```bash
# Required
DISCORD_TOKEN=       # Discord bot token (from Bot tab)
DISCORD_APP_ID=      # Discord application ID

# LLM (at least one required)
DEFAULT_MODEL=google:gemini-3-flash-preview  # provider:model format
GOOGLE_API_KEY=      # For google:* models
ANTHROPIC_API_KEY=   # For anthropic:* models (optional)
OPENAI_API_KEY=      # For openai:* models (optional)
```

### Model Format

Use `provider:model` format:
- `google:gemini-3-flash-preview`
- `google:gemini-2.5-pro-preview` (or gemini-3 when available)
- `anthropic:claude-sonnet-4-20250514`
- `openai:gpt-4o`

## Slash Commands

### `/character`
- `create <name> <persona>` - Create a character
- `list` - List all characters
- `select <name>` - Set active character for channel
- `info <name>` - Show character details
- `edit <name> <field> <value>` - Edit character
- `delete <name>` - Delete character

### `/world`
- `create <name>` - Create a world
- `init <world>` - Initialize world for this channel
- `status` - Show current world state
- `location <name> [description]` - Go to or create location
- `time <minutes>` - Advance time
- `weather <description>` - Set weather
- `locations` - List all locations

### `/memory`
- `add <content> [importance]` - Store a memory
- `search <query>` - Semantic search
- `important` - List important memories
- `forget <id>` - Delete a memory
- `stats` - Memory statistics

### `/session`
- `enable` - Enable bot in channel
- `disable` - Disable bot in channel
- `status` - Show session state
- `clear` - Clear history
- `scene <description>` - Set scene
- `debug` - Show context debug info

## Tech Stack

- **Runtime**: Bun
- **Discord**: Discordeno
- **LLM**: AI SDK (Google, Anthropic, OpenAI)
- **Database**: bun:sqlite + sqlite-vec
- **Embeddings**: Local via @huggingface/transformers (MiniLM)

## Development

```bash
bun run dev          # Development with watch
bun run lint         # Run oxlint
bun run check:types  # TypeScript check
bun test             # Run tests
```

## License

MIT
