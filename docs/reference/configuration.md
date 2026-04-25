# Configuration Reference

All configuration is via environment variables. Copy `.env.example` to `.env` and fill in what you need.

## Required

### `DISCORD_TOKEN`

Your bot's token from the [Discord Developer Portal](https://discord.com/developers/applications).

### `DISCORD_APP_ID`

Your bot's application ID (numeric), from the same page.

## LLM Models

### `DEFAULT_MODEL`

The model used when no `$model` directive is set on an entity. Format: `provider:model` for known providers, or a URL-based spec for OpenAI-compatible endpoints.

```
DEFAULT_MODEL=google:gemini-3-flash-preview
```

**Known providers:** See [provider list](#api-keys) below.

**OpenAI-compatible endpoints:** Use the base URL as the provider — unknown provider names are routed through `@ai-sdk/openai-compatible`:

```
DEFAULT_MODEL=http://localhost:11434:llama3          # Ollama (local)
DEFAULT_MODEL=https://my.proxy.io/v1:gpt-4          # Custom proxy
DEFAULT_MODEL=api.example.com:mistral-7b             # HTTPS assumed if no scheme
```

### `ALLOWED_MODELS`

Comma-separated allowlist of models entities can select via `$model`. Supports `*` wildcards.

```
ALLOWED_MODELS=google:*,anthropic:*
```

When unset, all models are allowed.

### `MAX_RESPONSE_CHAIN`

Default maximum number of consecutive self-triggered responses (an entity responding to itself). Prevents infinite loops. Default: `3`. Set to `0` for unlimited.

```
MAX_RESPONSE_CHAIN=3
```

This is the global default. Per-channel and per-server overrides can be set with `/config-chain` (requires Manage Webhooks). The override takes precedence over this env var.

## Startup Catch-Up

When the bot restarts, it can backfill messages it missed while offline.

### `CATCHUP_ON_STARTUP`

Controls when catch-up runs. Default: `all`.

| Value | Behavior |
|-------|----------|
| `all` | Fetch all bound channels immediately on startup |
| `lazy` | Fetch each channel on first message received there |
| `off` | Disable catch-up entirely |

### `CATCHUP_RESPOND`

Whether to evaluate and respond to missed messages during catch-up. Default: `false`.

When `true`, entities will respond to recent messages they missed, subject to `CATCHUP_RESPOND_MAX_AGE_MS`.

### `CATCHUP_RESPOND_MAX_AGE_MS`

Maximum age (in milliseconds) of a missed message that the bot will respond to during catch-up. Default: `300000` (5 minutes).

Messages older than this are stored in history but not responded to.

## Web Server

### `WEB`

Set to `false` to disable the built-in web API server. The web server is on by default.

```
WEB=false
```

### `WEB_PORT`

Port for the web API server. Default: `3000`. `PORT` is also accepted as a fallback.

```
WEB_PORT=3000
```

## Logging

### `LOG_LEVEL`

Verbosity of structured logs. Default: `info`.

| Value | Output |
|-------|--------|
| `debug` | Everything, including message processing internals |
| `info` | Normal operation |
| `warn` | Warnings and errors only |
| `error` | Errors only |

## API Keys

Set the key for each LLM provider you want to use. At least one is required.

| Provider | Env var | Notes |
|----------|---------|-------|
| Google AI | `GOOGLE_GENERATIVE_AI_API_KEY` | Required for default `google:*` models |
| Anthropic | `ANTHROPIC_API_KEY` | For `anthropic:*` models |
| OpenAI | `OPENAI_API_KEY` | For `openai:*` models |
| Groq | `GROQ_API_KEY` | |
| Mistral | `MISTRAL_API_KEY` | |
| xAI | `XAI_API_KEY` | |
| DeepSeek | `DEEPSEEK_API_KEY` | |
| Cohere | `COHERE_API_KEY` | |
| Cerebras | `CEREBRAS_API_KEY` | |
| Perplexity | `PERPLEXITY_API_KEY` | |
| Together AI | `TOGETHER_AI_API_KEY` | |
| Fireworks | `FIREWORKS_API_KEY` | |
| DeepInfra | `DEEPINFRA_API_KEY` | |
| HuggingFace | `HUGGINGFACE_API_KEY` | |
| Azure | `AZURE_API_KEY` | |
| Google Vertex | `GOOGLE_VERTEX_API_KEY` | |
| Amazon Bedrock | `AMAZON_BEDROCK_ACCESS_KEY_ID` + `AMAZON_BEDROCK_SECRET_ACCESS_KEY` | |

## Image Generation

For entities that use image-generation models (e.g. `google:gemini-2.0-flash-image-generation`), generated images are returned as Discord attachments automatically — no extra configuration needed for that.

The following env vars control **ComfyUI-based** image generation (separate pipeline):

### RunComfy

```
RUNCOMFY_API_KEY=
```

Or serverless:

```
RUNCOMFY_SERVERLESS_API_KEY=
RUNCOMFY_SERVERLESS_DEPLOYMENT_ID=
RUNCOMFY_SERVERLESS_OVERRIDE_MAPPING=   # JSON mapping of variable names to node paths
```

### SaladCloud

```
SALADCLOUD_API_KEY=
SALADCLOUD_ORG_NAME=
```

### RunPod

```
RUNPOD_API_KEY=
RUNPOD_COMFY_ENDPOINT_ID=
```

### Self-Hosted ComfyUI

```
COMFYUI_ENDPOINT=http://localhost:8188
```

## Image Storage

For persistent image URLs (instead of ephemeral Discord attachments):

```
S3_ENDPOINT=          # e.g. https://xxx.r2.cloudflarestorage.com
S3_BUCKET=
S3_REGION=auto
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_PUBLIC_URL=        # Public base URL for generated links
```

Compatible with Cloudflare R2, AWS S3, MinIO, and any S3-compatible storage.
