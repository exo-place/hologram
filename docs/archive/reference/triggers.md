# Response Control Reference

Control when the bot responds using `$respond` directives and `$if` conditionals.

## Basic Syntax

### Always respond

```
$respond
```

### Never respond (suppress)

```
$respond false
```

### Conditional response

```
$if <condition>: $respond
```

## Conditions

Conditions are **JavaScript expressions** with access to context variables.

::: tip String Quoting
Since expressions are JavaScript, strings must be quoted: `"hello"` not `hello`.

```
# Correct
$if content.includes("hello"): $respond

# Wrong - hello is treated as an undefined variable
$if content.includes(hello): $respond
```
:::

### Context Variables

| Variable | Type | Description |
|----------|------|-------------|
| `mentioned` | boolean | Bot was @mentioned |
| `replied` | boolean | Message is a reply to this entity's message |
| `replied_to` | string | Name of entity that was replied to (empty if not a webhook reply) |
| `is_self` | boolean | Message is from this entity's own webhook |
| `is_hologram` | boolean | Message is from any hologram entity (our webhook) |
| `is_forward` | boolean | Message is a Discord forward |
| `keyword_match` | boolean | Message matched one of this entity's configured trigger keywords |
| `content` | string | Message content (alias for `messages(1, "%m")`) |
| `author` | string | Message author name (alias for `messages(1, "%a")`) |
| `interaction_type` | string | Interaction verb set when triggered via `trigger_entity` tool or `/trigger <entity> <verb>` (e.g. `"drink"`, `"eat"`, `"open"`) |
| `name` | string | This entity's name |
| `chars` | string[] | Names of all entities bound to this channel |
| `group` | string | All bound character names, comma-separated |
| `response_ms` | number | Milliseconds since last response |
| `retry_ms` | number | Milliseconds since triggering message (for retries) |
| `idle_ms` | number | Milliseconds since any message in channel |
| `unread_count` | number | Messages in channel since this entity's last reply |
| `random()` | function | Float [0,1), or int with `random(max)` [1,max] / `random(min,max)` [min,max] |
| `has_fact(pattern)` | function | Check if entity has matching fact |
| `roll(dice)` | function | Dice roll (roll20 syntax: `"2d6+3"`, `"4d6kh3"`, `"1d6!"`, `"8d6>=5"`) |
| `pick(array)` | function | Pick a random element from an array |
| `mentioned_in_dialogue(name)` | function | Check if name appears in the message. Single-line messages: checks full text. Messages with quotes (`"..."` / `'...'`): checks only inside quoted portions. Multi-line messages without quotes: returns `false`. Uses word-boundary matching (case-insensitive). |
| `messages(n, format, filter)` | function | Last n messages. Format: `%a`=author, `%m`=message. Filter: `"$user"`, `"$char"`, or author name |
| `duration(ms)` | function | Human-readable duration (e.g. `duration(idle_ms)` → "5 minutes") |
| `date_str(offset?)` | function | Date string (e.g. "Thu Jan 30 2026"). Optional offset: `"1d"`, `"-1w"` |
| `time_str(offset?)` | function | Time string (e.g. "6:00 PM"). Optional offset |
| `isodate(offset?)` | function | ISO date (e.g. "2026-01-30"). Optional offset |
| `isotime(offset?)` | function | ISO time (e.g. "18:00"). Optional offset |
| `weekday(offset?)` | function | Day name (e.g. "Thursday"). Optional offset |
| `time.hour` | number | Current hour (0-23) |
| `time.is_day` | boolean | 6am-6pm |
| `time.is_night` | boolean | 6pm-6am |
| `channel.id` | string | Channel snowflake ID |
| `channel.name` | string | Channel name |
| `channel.description` | string | Channel topic |
| `channel.is_nsfw` | boolean | Whether the channel is NSFW |
| `channel.type` | string | Channel type (`"text"`, `"vc"`, `"thread"`, `"forum"`, `"announcement"`, `"dm"`, etc.) |
| `channel.mention` | string | Channel mention (e.g. `<#123>`) |
| `server.id` | string | Server snowflake ID |
| `server.name` | string | Server name |
| `server.description` | string | Server description |
| `server.nsfw_level` | string | Server NSFW level (`"default"`, `"explicit"`, `"safe"`, `"age_restricted"`) |
| `Date` | object | Safe date constructor: `Date.now()`, `Date.new(...)`, `Date.parse(...)`, `Date.UTC(...)` |
| `self.*` | varies | Entity's own `key: value` facts |

### Examples

Respond when mentioned:
```
$if mentioned: $respond
```

Respond 10% of the time:
```
$if random() < 0.1: $respond
```

Respond to keywords:
```
$if content.includes("hello"): $respond
```

Check conversation history:
```
$if messages(10).includes("help"): $respond
```

Respond only at night:
```
$if time.is_night: $respond
```

Minimum 30 seconds between responses:
```
$if response_ms > 30000: $respond
```

## Default Behavior

If no `$respond` directive is present, the bot responds when:
- The bot is @mentioned (and only one entity is bound to the channel)
- A message replies directly to this entity's message
- This entity's name is mentioned in dialogue
- A message matches this entity's configured trigger keywords

To respond to all messages, add:
```
$respond
```

To never respond (disable the entity), add:
```
$respond false
```

## Multiple Conditions

Multiple `$if` lines are evaluated in order. The last matching `$respond` wins.

```
$respond false
$if mentioned: $respond
$if random() < 0.1: $respond
```

This suppresses responses by default, but responds if mentioned OR 10% randomly.

## Delayed Response with $retry

Schedule a re-evaluation after a delay:

```
$retry 5000
```

This is useful for batching messages or creating "thinking" delays.

Example - wait 3 seconds then respond if no new messages:
```
$retry 3000
$if retry_ms > 2000: $respond
```

## Examples

### Respond to mentions only (default)

No special facts needed, or explicitly:
```
$if mentioned: $respond
```

### Responsive NPC

Responds to mentions, name patterns, and occasionally randomly:
```
$if mentioned: $respond
$if content.match(/bartender|barkeep/i): $respond
$if random() < 0.05: $respond
```

### Rate-limited responses

Respond to everything, but only once per minute:
```
$if response_ms > 60000: $respond
```

### Quiet observer

Small chance to respond, with minimum spacing:
```
$if random() < 0.05 && response_ms > 120000: $respond
```

### Message count threshold

Respond every 5 messages (or when mentioned):
```
$if unread_count >= 5: $respond
$if mentioned: $respond
```

### Night owl

Only active at night:
```
$if time.is_night && mentioned: $respond
```

### Keyword bot

Only responds to specific patterns:
```
$respond false
$if content.startsWith("!help"): $respond
$if content.startsWith("!roll"): $respond
```

### Name-triggered character

Responds when their name is mentioned in dialogue (not from self):
```
$if mentioned_in_dialogue(name) && !is_self: $respond
```

### Character aware of other characters

Responds when another character is mentioned:
```
$if mentioned_in_dialogue("Alice"): $respond
$if mentioned_in_dialogue("Bob"): $respond
```

## Self Context

Facts in `key: value` format are accessible via `self.*`:

```
mood: happy
energy: 0.8
$if self.energy > 0.5: $respond
```

This lets entities have dynamic behavior based on their state.
