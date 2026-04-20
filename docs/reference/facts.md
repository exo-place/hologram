# Facts Reference

Facts are freeform text statements attached to entities. They describe what an entity is, how it behaves, and when it responds. Most facts are plain descriptions, but some patterns — macros and directives — have special meaning to the system.

::: tip Try it out
Test fact evaluation interactively in the [Fact Evaluation Playground](/playground/facts).
:::

## Fact Format

Facts are stored one per line. Each fact is either:

- **A description** — plain text shown to the LLM as part of the entity's definition
- **A macro expansion** — `{{...}}` syntax replaced with a computed value at evaluation time
- **A directive** — a `$`-prefixed instruction that controls entity behavior, not shown as descriptive content

```
is a character
has silver hair and violet eyes
is currently in {{entity:12}}
$if mentioned: $respond
$model google:gemini-2.0-flash
```

Lines beginning with `$#` at the very first column are comments — stripped entirely, never shown to the LLM:

```
$# This is a comment and won't appear anywhere
 $# This starts with a space, so it IS shown to the LLM
```

Facts in `key: value` format are parsed into the `self` context object, making them accessible in `$if` expressions:

```
mood: happy
energy: 0.8
$if self.energy < 0.3: seems tired and sluggish
```

Key-value facts are still regular facts — the LLM sees them as plain text. The `self.*` binding is a bonus.

---

## Macros

Macros are `{{...}}` patterns expanded before facts are sent to the LLM. They run at evaluation time, so a fact like `{{random: happy, sad}}` produces a different value each time the entity is evaluated.

If a macro expression errors, the original `{{...}}` text is preserved unchanged.

### Entity Reference

**`{{entity:ID}}`** — Expands to the referenced entity's name and pulls that entity's facts into the LLM context.

```
is in {{entity:12}}
is friends with {{entity:5}}
```

The entity is automatically included in the context even if not otherwise bound. Use the ID from the entity's URL or the `/view` command.

### Identity

| Macro | Expands to |
|-------|-----------|
| `{{char}}` | This entity's own name |
| `{{user}}` | The literal string `"user"` |

```
{{char}} speaks formally and chooses words carefully
refers to the player as {{user}}
```

### Date and Time

| Macro | Expands to | Example |
|-------|-----------|---------|
| `{{date}}` | Current date | `Thu Jan 30 2026` |
| `{{time}}` | Current time | `6:00:00 PM` |
| `{{weekday}}` | Day of week | `Thursday` |
| `{{isodate}}` | ISO date | `2026-01-30` |
| `{{isotime}}` | ISO time | `18:00` |

```
today is {{date}}, a {{weekday}}
the current time is {{isotime}}
```

### Channel and Group

| Macro | Expands to |
|-------|-----------|
| `{{group}}` | Comma-separated names of all entities bound to this channel |
| `{{charIfNotGroup}}` | This entity's name when alone in channel; empty string in a group |
| `{{notChar}}` | All bound entities' names except this one |
| `{{groupNotMuted}}` | Names of entities that are currently responding |
| `{{model}}` | The active LLM model spec (e.g. `google:gemini-2.0-flash`) |
| `{{maxPrompt}}` | The active context expression |
| `{{idle_duration}}` | Human-readable time since the last message (e.g. `5 minutes`) |

### Message History

| Macro | Expands to |
|-------|-----------|
| `{{lastMessage}}` | The most recent message in `Author: content` format |
| `{{lastUserMessage}}` | The most recent human message |
| `{{lastCharMessage}}` | The most recent entity/bot message |

### Parameterized

**`{{random: A, B, C}}`** — Picks one item at random from the comma-separated list.

```
{{random: happy, sad, excited, pensive}} today
```

**`{{roll: NdN+N}}`** — Rolls dice using roll20 syntax (supports `kh`, `kl`, `dh`, `dl`, `!`, `>=`).

```
rolled a {{roll: 1d20}} for initiative
has {{roll: 2d6+3}} hit points
```

**`{{newline}}`** / **`{{newline::N}}`** — One or N newlines.

**`{{space}}`** / **`{{space::N}}`** — One or N spaces.

**`{{noop}}`** — Expands to an empty string. Useful as a no-op placeholder.

**`{{trim}}`** — Trims all surrounding whitespace from the fact after expansion.

### Expression Macros

Any valid expression can appear inside `{{...}}`. This includes `self.*`, `channel.*`, `server.*`, function calls, and any variable from the expression context.

```
is currently in {{channel.name}}
has {{self.health}} health points
was last seen {{idle_duration}} ago
```

See [Expressions Reference](/reference/expressions) for all available variables.

---

## Directives

Directives are `$`-prefixed fact lines that control entity behavior. They are processed at evaluation time and stripped from the facts shown to the LLM (they are instructions to the system, not descriptions).

Any directive can be made conditional using `$if`:

```
$if channel.is_nsfw: $safety off
$if mentioned: $respond
```

Directives evaluate top to bottom. When multiple directives of the same kind appear, the last one that matches wins (except where noted).

---

### `$if <expr>: <fact or directive>`

Conditionally include a fact or activate a directive. The expression is evaluated at message time using the full expression context.

```
$if time.is_night: glows faintly in the dark
$if mentioned: $respond
$if random() < 0.1: is in an unusually good mood
$if self.energy > 0.5: seems energetic and focused
```

Expressions are JavaScript. Strings must be quoted:

```
$if content.includes("hello"): $respond   # correct
$if content.includes(hello): $respond     # wrong — hello is an undefined variable
```

For the full expression language including all available variables, see [Expressions Reference](/reference/expressions).

---

### Response Control

#### `$respond` / `$respond false`

Controls whether the entity responds to a message. Multiple `$respond` directives are evaluated in order; the last one that matches wins.

```
$respond              # always respond
$respond false        # never respond
$if mentioned: $respond        # respond when @mentioned
$if random() < 0.1: $respond   # respond 10% of the time
```

**Default behavior:** When no `$respond` directive is present, the entity responds when @mentioned or when its name appears in message content.

#### `$retry <ms>`

Stops evaluation immediately and re-evaluates after `ms` milliseconds. Useful for batching rapid messages or creating deliberate pauses before responding.

```
$retry 3000                          # pause for 3 seconds, then re-evaluate
$if retry_ms > 2000: $respond        # respond if 2+ seconds have elapsed since the trigger
```

When `$retry` fires, no response is sent yet. After the delay, the entity's facts are re-evaluated with `retry_ms` updated to reflect elapsed time. This allows patterns like "wait for conversation to settle, then respond."

---

### Output Directives

#### `$stream` / `$stream full`

Enables streaming responses instead of sending the complete reply at once.

```
$stream                       # new message per newline, each sent when complete
$stream "\n\n"                # new message per double-newline
$stream "---" "\n\n"         # new message per either delimiter
$stream full                  # single message, edited progressively as content streams
$stream full "\n\n"           # new message per double-newline, each edited progressively
```

**Default (no `$stream`):** The entire response is generated before sending as a single message.

**`$stream` (lines mode):** The response is split at each delimiter (default: newline). Each segment is sent as a complete, separate message once the delimiter is reached.

**`$stream full`:** The response is sent as a live-editing message, progressively updated as tokens arrive. With a delimiter, each segment gets its own message that is edited in place.

Can also be set via `/edit <entity> type:config`.

#### `$freeform`

When multiple entities are responding in a group, normally the LLM formats its reply with name prefixes so each entity's response can be split apart. `$freeform` disables that splitting — the response is posted as one combined message without attribution.

```
$freeform
```

#### `$model <provider:model>`

Override the LLM used for this entity's responses. Format: `provider:model` for known providers, or a URL-based spec for OpenAI-compatible endpoints.

```
$model google:gemini-2.0-flash
$model anthropic:claude-opus-4-5
$model openai:gpt-4o
$if mentioned: $model anthropic:claude-opus-4-5

# OpenAI-compatible endpoints (unknown provider = base URL)
$model http://localhost:11434:llama3
$model https://my.proxy.io/v1:gpt-4
```

The model spec must match a configured provider or a reachable OpenAI-compatible endpoint. Can also be set via `/edit <entity> type:config`.

#### `$context <expr>`

Control how many messages from history are included in the LLM context. The expression is evaluated per-message (newest to oldest); evaluation stops when it returns false.

```
$context chars < 8000              # stop when accumulated chars exceed 8000
$context 8k                        # shorthand for the above
$context count < 50                # include at most 50 messages
$context age_h < 24               # exclude messages older than 24 hours
$context chars < 16000 && age_h < 12   # combined constraint
```

**Available variables:** `chars` (accumulated character count), `count` (message count), `age` (age in ms), `age_h` (hours), `age_m` (minutes), `age_s` (seconds).

Can also be set via `/edit <entity> type:config`.

#### `$strip` / `$strip "<pattern>"`

Strip specific strings from message history before sending to the LLM.

```
$strip "</blockquote>"                   # strip this string from all history
$strip "</blockquote>" "<br>"           # strip multiple patterns
$strip                                   # explicitly disable all stripping
$if mentioned: $strip "</blockquote>"    # conditional stripping
```

Patterns are quoted strings. Escape sequences `\n`, `\t`, `\\` are supported.

**Default behavior:** When no `$strip` directive is present, `</blockquote>` is automatically stripped for `gemini-2.5-flash-preview` models only. Bare `$strip` with no arguments explicitly disables this default.

Multiple `$strip` directives evaluate in order; the last one wins.

#### `$thinking` / `$thinking <level>`

Control the reasoning depth for LLM calls. Higher levels use more reasoning tokens, increasing quality at the cost of latency and token usage.

```
$thinking                     # enable high thinking (same as $thinking high)
$thinking minimal             # suppress thinking (default when absent)
$thinking low                 # low reasoning effort
$thinking medium              # medium reasoning effort
$thinking high                # maximum reasoning effort
$if mentioned: $thinking high  # think harder when directly addressed
```

**Valid levels:** `minimal`, `low`, `medium`, `high`

**Default:** All providers default to `minimal` when no `$thinking` directive is present.

**Provider behavior:**

| Level | Google (Gemini 3) | Google (Gemini 2.5) | Anthropic | OpenAI |
|-------|------------------|---------------------|-----------|--------|
| `minimal` | `thinkingLevel: "minimal"` | `thinkingBudget: 0` | no change | no change |
| `low` | `thinkingLevel: "low"` | `thinkingBudget: 1024` | `budgetTokens: 2048` | `reasoningEffort: "low"` |
| `medium` | `thinkingLevel: "medium"` | `thinkingBudget: 8192` | `budgetTokens: 10000` | `reasoningEffort: "medium"` |
| `high` | `thinkingLevel: "high"` | `thinkingBudget: 24576` | `budgetTokens: 32000` | `reasoningEffort: "high"` |

Google models think by default, so `minimal` actively suppresses it. Anthropic and OpenAI do not think by default — only `low`/`medium`/`high` enables reasoning for those providers. Unsupported providers ignore the directive.

Can also be set via `/edit <entity> type:Advanced`.

#### `$collapse` / `$collapse <roles>`

Controls which adjacent same-role messages are merged into a single turn when building the LLM context. By default all roles are collapsed.

```
$collapse                          # collapse all roles (explicit default)
$collapse all                      # same as bare $collapse
$collapse none                     # keep every message as a distinct turn
$collapse user                     # only collapse adjacent user messages
$collapse assistant                # only collapse adjacent assistant messages
$collapse user assistant           # collapse user and assistant, not system
$if channel.name == "log": $collapse none   # conditional: keep turns distinct in #log
```

**Roles:** `user`, `assistant`, `system`. Space-separated for multiple. `none` and `all` are special keywords.

**Default:** All roles are collapsed when no `$collapse` directive is present.

Multiple `$collapse` directives evaluate in order; the last one wins.

Can also be set via `/edit <entity> type:Advanced`.

---

### Safety Directives

#### `$safety [category] <threshold-or-expr>`

Override the provider's content filter thresholds. Multiple `$safety` directives accumulate; the last one per category wins.

```
$safety off                          # disable all safety filters
$safety none                         # block nothing (provider minimum)
$safety high                         # block most aggressively
$safety sexual off                   # disable the sexual content filter only
$safety hate medium                  # hate speech at medium threshold
$safety channel.is_nsfw              # relax all filters when channel is NSFW
$safety sexual channel.is_nsfw       # relax sexual filter only in NSFW channels
$if channel.is_nsfw: $safety off     # same, using $if syntax
```

**Categories:** `sexual`, `hate`, `harassment`, `dangerous`, `civic`. Omit the category to apply the threshold to all categories.

**Thresholds:**

| Threshold | Meaning |
|-----------|---------|
| `off` | Disable filter entirely |
| `none` | Block nothing (least restrictive) |
| `low` | Block low-severity and above |
| `medium` | Block medium-severity and above |
| `high` | Block only high-severity content (most permissive) |

**Boolean expressions:** When a boolean expression is used instead of a threshold keyword (e.g. `channel.is_nsfw`), `true` maps to `off` (disable filter) and `false` means no override. This is the standard way to relax filters conditionally based on channel NSFW status.

**Provider mapping (Google):** `off`→`OFF`, `none`→`BLOCK_NONE`, `low`→`BLOCK_LOW_AND_ABOVE`, `medium`→`BLOCK_MEDIUM_AND_ABOVE`, `high`→`BLOCK_ONLY_HIGH`. Other providers currently ignore safety directives.

Can also be set via `/edit <entity> type:Advanced`.

---

### Content Directives

#### `$avatar <url>`

Set the webhook avatar URL used when this entity posts messages.

```
$avatar https://example.com/aria.png
```

If not set, Discord's default webhook avatar is used. Can also be set via `/edit <entity> type:config`.

#### `$memory` / `$memory <scope>`

Enable semantic memory retrieval for this entity. Relevant memories are included in context when they match the incoming messages.

```
$memory                   # same as $memory none (no retrieval)
$memory none              # disable memory retrieval (default)
$memory channel           # retrieve memories relevant to this channel's messages
$memory guild             # retrieve memories from all channels in this server
$memory global            # retrieve all memories regardless of channel
```

**Default:** Memory retrieval is disabled. Memories must be explicitly added via `/edit <entity>` and retrieval enabled here.

Can also be set via `/edit <entity> type:config`.

---

### Permission Directives

Permission directives control who can interact with an entity and whether the LLM can modify it.

#### `$locked`

Prevents the LLM from modifying this entity via tools (`add_fact`, `update_fact`, `remove_fact`). The LLM can still read all facts; it just cannot change them.

```
$locked
```

#### `$locked <fact>`

Locks a specific fact from LLM modification while keeping it visible in context. The fact content (without the `$locked` prefix) is shown to the LLM normally.

```
$locked has silver hair
$locked is loyal to the queen
$locked name: Aria
```

The LLM sees the fact as a regular fact but any tool call attempting to modify or remove it will fail.

#### `$edit <entries>`

Controls which Discord users can edit this entity via `/edit`. Accepts usernames, Discord user IDs (17–19 digit snowflakes), and role IDs (prefixed with `role:`).

```
$edit @everyone               # anyone can edit
$edit alice, bob              # only these usernames
$edit 123456789012345678      # specific Discord user or role ID
```

**Default:** Owner only.

Can also be configured via `/edit <entity> type:permissions`.

#### `$view <entries>`

Controls which Discord users can view this entity via `/view`.

```
$view @everyone               # anyone can view
$view alice, bob              # specific usernames
$view 123456789012345678      # specific Discord user or role ID
```

**Default:** Owner only.

Can also be configured via `/edit <entity> type:permissions`.

#### `$use <entries>`

Controls which Discord users can trigger responses from this entity (via chat or `/trigger`).

```
$use @everyone                # anyone can trigger (effectively the default)
$use alice, bob               # restrict to these users
$use 123456789012345678       # specific Discord user or role ID
```

**Default:** No restriction — everyone can trigger.

Can also be configured via `/edit <entity> type:permissions`.

#### `$blacklist <entries>`

Blocks specific users from triggering this entity. Owner is never blocked regardless of blacklist.

```
$blacklist troublemaker
$blacklist 123456789012345678
$blacklist user1, 123456789, user2
```

Can also be configured via `/edit <entity> type:permissions`.
