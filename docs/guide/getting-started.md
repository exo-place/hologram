---
title: Getting Started
---

# Getting Started

This guide gets you from zero to a working AI character responding in a Discord channel. Budget about 10 minutes.

## Prerequisites

- **Bun** — [bun.sh](https://bun.sh). Hologram uses Bun as its runtime.
- **A Discord bot token** — create an application at [discord.com/developers](https://discord.com/developers/applications), add a Bot, and copy the token. Enable the Message Content Intent under Bot → Privileged Gateway Intents.
- **An AI provider API key** — the default model is Google Gemini. Get a key at [aistudio.google.com](https://aistudio.google.com/api-keys). Any supported provider works; see `.env.example` for the full list.

## Install

Clone the repo and install dependencies:

```sh
git clone https://github.com/exoplace/hologram
cd hologram
bun install
```

Copy the example env file and fill in your values:

```sh
cp .env.example .env
```

At minimum, set these three:

```sh
DISCORD_TOKEN=your_bot_token_here
DISCORD_APP_ID=your_app_id_here
GOOGLE_GENERATIVE_AI_API_KEY=your_key_here
```

Start the bot:

```sh
bun run dev
```

You should see the bot come online in Discord. Slash commands are registered automatically on startup.

## Create Your First Character

In any channel where the bot is present, run:

```
/create Aria
```

This creates an entity named "Aria". You'll see a confirmation with her ID.

You can also open `/create` without arguments to get a modal where you can enter the name and initial facts at the same time.

## Add Personality

Facts are the core of how Hologram works. Each fact is a line of freeform text that shapes how the character thinks and responds.

Run `/edit Aria` to open the fact editor. Add facts, one per line:

```
is a traveling merchant with silver hair and violet eyes
speaks with a slight accent and tends to be cautious around strangers
carries a worn leather satchel full of maps and small trinkets
is currently passing through a small village
$if mentioned: $respond
```

That last line — `$if mentioned: $respond` — is a directive that tells Aria to respond when she's @mentioned. Without any `$respond` directive, the entity exists but stays silent. You can also add a bare `$respond` to make her reply to every message in the channel.

Save the modal. Facts take effect immediately.

## Bind to a Channel

Binding connects a Discord channel to an entity, so the bot knows which character "owns" that channel.

In the channel where you want Aria to respond:

```
/bind channel Aria
```

Done. Aria is now the active character in this channel.

## Verify It Works

@mention Aria in the channel:

```
Hey @Aria, what are you selling today?
```

She should respond based on her facts. If she doesn't:

- Check that `$if mentioned: $respond` (or just `$respond`) is in her facts — `/view Aria` to confirm.
- Check that the binding took — `/debug` shows the current channel's bound entity and recent message count.
- Check the bot logs for errors.

## What's Next

- [Core Concepts](/guide/concepts) — understand the entity-facts model before going further
- [Personas](/guide/personas) — speak as a character yourself
- [Multi-Character Channels](/guide/multi-character) — multiple entities in one channel
- [Expressions Reference](/reference/directives) — full `$if`, `$respond`, `$stream`, and other directives
- [Commands Reference](/reference/commands) — every slash command
