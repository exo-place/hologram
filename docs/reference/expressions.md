# Expression Language Reference

Expressions are a restricted JavaScript dialect used in two places:

- **`$if` conditions** — control when a fact applies or when the entity responds.
  ```
  $if random() < 0.3: has fox ears
  $if mentioned && time.is_night: $respond
  ```

- **`{{expression}}` macros** — embed dynamic values inside fact text, templates, and system prompts.
  ```
  The current time is {{time_str()}}.
  You are speaking in #{{channel.name}}.
  ```

Both use the same evaluator and have access to the same context variables. `$if` conditions cast the result to boolean. Macros convert the result to a string (`null`/`undefined` become empty string).

## Operators

### Supported

| Category | Operators | Notes |
|----------|-----------|-------|
| Arithmetic | `+` `-` `*` `/` `%` | Standard math; `+` also concatenates strings |
| Comparison | `<` `>` `<=` `>=` | Numeric and string comparison |
| Equality | `==` `!=` `===` `!==` | Loose and strict equality |
| Logical | `&&` `\|\|` `!` | AND, OR, NOT |
| Ternary | `condition ? a : b` | Conditional expression |
| Unary minus | `-x` | Negation |
| Grouping | `(...)` | Force evaluation order |

### Not supported

Arrays literals (`[]`), object literals (`{}`), `in`, `instanceof`, `typeof`, `new`, assignment (`=`), increment/decrement (`++`/`--`), bitwise operators, optional chaining (`?.`), nullish coalescing (`??`), and template literals (`` ` `` ) are not available. The evaluator parses a safe subset only.

## String Methods

All standard string methods are available via dot notation **unless explicitly blocked**. The pattern is always string literal — no dynamic patterns (see [Regex Patterns](#regex-patterns)).

### Regex-accepting methods

These compile their first argument as a regex pattern. The pattern must be a **string literal** — no variables.

| Method | Example |
|--------|---------|
| `.match(pattern)` | `content.match("\\bhello\\b")` — returns array or `null` |
| `.search(pattern)` | `content.search("\\d+") >= 0` — returns index or `--1` |
| `.replace(pattern, replacement)` | `content.replace("\\s+", " ")` — first match only |
| `.split(pattern)` | `content.split("\\s+").length > 5` — returns array |

### Safe-wrapped methods (output size limited to 100,000 characters)

| Method | Example |
|--------|---------|
| `.repeat(n)` | `"ha".repeat(3)` → `"hahaha"` |
| `.padStart(n, fill?)` | `"7".padStart(3, "0")` → `"007"` |
| `.padEnd(n, fill?)` | `"hi".padEnd(5, ".")` → `"hi..."` |
| `.replaceAll(search, replacement)` | `content.replaceAll("bad", "good")` — literal string, all matches |

### Blocked

| Method | Alternative |
|--------|-------------|
| `.matchAll()` | Use `.match()` instead |

### Other string methods

Any other standard string method works as-is: `.includes()`, `.startsWith()`, `.endsWith()`, `.indexOf()`, `.slice()`, `.substring()`, `.toLowerCase()`, `.toUpperCase()`, `.trim()`, `.trimStart()`, `.trimEnd()`, `.at()`, `.length`, etc.

```
$if content.includes("hello"): $respond
$if content.startsWith("!"): $respond
$if content.toLowerCase().includes("help"): $respond
$if content.trim().length > 0: $respond
```

## Array Methods

Arrays returned by functions (e.g. from `.split()`, `chars`) support standard array methods and properties:

| Method/Property | Example |
|-----------------|---------|
| `.length` | `content.split(" ").length` |
| `.join(sep?)` | `chars.join(" and ")` (safe-wrapped, output limited) |
| `.includes(val)` | `chars.includes("Alice")` |
| `.indexOf(val)` | `chars.indexOf("Bob")` |
| `.at(n)` | `chars.at(0)` — first element |

## Built-in Functions

### `random(min?, max?)`

Returns a random number.

| Call | Behavior |
|------|----------|
| `random()` | Float in `[0, 1)` |
| `random(max)` | Integer in `[1, max]` |
| `random(min, max)` | Integer in `[min, max]` inclusive |

```
$if random() < 0.1: $respond
$if random(6) >= 5: rolled a critical
$if random(1, 20) == 20: rolled a natural 20
```

### `roll(dice)`

Rolls dice using Roll20 syntax. Returns a number.

| Syntax | Meaning |
|--------|---------|
| `roll("2d6")` | Sum of 2d6 |
| `roll("1d20+5")` | 1d20 plus 5 |
| `roll("3d8-2")` | 3d8 minus 2 |
| `roll("4d6kh3")` | Roll 4d6, keep highest 3 |
| `roll("4d6kl1")` | Roll 4d6, keep lowest 1 |
| `roll("4d6dh1")` | Roll 4d6, drop highest 1 |
| `roll("4d6dl1")` | Roll 4d6, drop lowest 1 |
| `roll("1d6!")` | Exploding d6 (reroll and add on max, capped at 100 explosions) |
| `roll("8d6>=5")` | Count dice that roll 5 or higher |

```
$if roll("1d20") >= 15: passes the skill check
$if roll("2d6") == 12: $respond
```

### `pick(array)`

Returns a uniformly random element from an array. Returns `undefined` if the array is empty.

```
{{pick(["hello", "hi", "hey"])}}
$if pick([true, false, false]): $respond
```

### `has_fact(pattern)`

Returns `true` if the entity has any fact that includes `pattern` as a substring (case-insensitive).

```
$if has_fact("poisoned"): takes damage
$if has_fact("$respond"): (check if entity has a respond directive)
```

### `mentioned_in_dialogue(name)`

Returns `true` if `name` appears in the message. The check is word-boundary and case-insensitive.

Scope rules:
- **Single-line messages without quotes**: checks the full message text.
- **Messages with quotation marks** (`"..."` or `'...'`): checks only inside the quoted portions.
- **Multi-line messages without quotes**: returns `false`.

This makes the check suitable for detecting whether a name was spoken as dialogue rather than merely appearing in narration.

```
$if mentioned_in_dialogue(name): $respond
$if mentioned_in_dialogue("Alice"): $respond
```

### `messages(n?, format?, filter?)`

Returns the last `n` messages from the channel as a formatted string.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `n` | 1 | Number of messages to retrieve |
| `format` | `"%a: %m"` | Template: `%a` = author name, `%m` = message content |
| `filter` | (all) | `"$user"` = only user messages, `"$char"` = only entity/webhook messages, or an author name |

```
$if messages(5).includes("help"): someone asked for help
$if messages(1, "%m").startsWith("!"): command message
messages(3, "%a: %m", "$user")  →  last 3 user messages with author names
```

`content` and `author` are shorthand for `messages(1, "%m")` and `messages(1, "%a")` respectively.

### `duration(ms)`

Formats a millisecond value as a human-readable string. Picks the two largest non-zero units.

```
duration(90000)    →  "1 minute 30 seconds"
duration(3661000)  →  "1 hour 1 minute"
duration(0)        →  "just now"
```

### Date/time functions

All accept an optional `offset` string (see [Offset Format](#offset-format)).

| Function | Returns | Example |
|----------|---------|---------|
| `date_str(offset?)` | `"Thu Jan 30 2026"` | Current date, short format |
| `time_str(offset?)` | `"6:00 PM"` | Current local time |
| `isodate(offset?)` | `"2026-01-30"` | ISO 8601 date |
| `isotime(offset?)` | `"18:00"` | ISO 8601 time (hours and minutes) |
| `weekday(offset?)` | `"Thursday"` | Full weekday name |

```
Today is {{weekday()}}.
The date in 7 days is {{isodate("7d")}}.
```

#### Offset Format

Offsets are strings like `"1d"`, `"-2w"`, `"3 hours 30 minutes"`, `"1y2mo"`. Supported units:

| Unit | Abbreviations |
|------|---------------|
| Years | `y`, `year`, `years` |
| Months | `mo`, `month`, `months` |
| Weeks | `w`, `week`, `weeks` |
| Days | `d`, `day`, `days` |
| Hours | `h`, `hour`, `hours` |
| Minutes | `m`, `min`, `mins`, `minute`, `minutes` |
| Seconds | `s`, `sec`, `secs`, `second`, `seconds` |

Negative offsets look back in time: `"-1d"` is yesterday.

### `Date` object

A safe wrapper around the JavaScript `Date` API.

| Property | Description |
|----------|-------------|
| `Date.now()` | Current timestamp in milliseconds since Unix epoch |
| `Date.new()` | `new Date()` — current date/time |
| `Date.new(timestamp)` | `new Date(ms)` — from Unix timestamp |
| `Date.new(dateString)` | `new Date("2026-01-01")` — from date string |
| `Date.new(year, month, ...)` | `new Date(year, month, day?, ...)` — from components (month is 0-indexed) |
| `Date.parse(string)` | Parse date string to ms timestamp (or `NaN` if invalid) |
| `Date.UTC(year, month?, ...)` | UTC timestamp from components |

`Date.new()` returns a real `Date` object — you can call `.getTime()`, `.getFullYear()`, `.toISOString()` etc. on the result.

```
$if Date.now() - response_ms > 86400000: been more than a day
{{Date.new().toISOString()}}
```

## Context Variables

These are available in all `$if` expressions. They are also available in `{{...}}` macros.

### Message

| Variable | Type | Description |
|----------|------|-------------|
| `content` | string | Text of the most recent message |
| `author` | string | Name of the most recent message's author |
| `mentioned` | boolean | The entity was @mentioned |
| `replied` | boolean | The message is a reply to this entity's message |
| `replied_to` | string | Name of the entity that was replied to (empty if not a webhook reply) |
| `is_forward` | boolean | The message is a Discord forward |
| `is_self` | boolean | The message is from this entity's own webhook |
| `is_hologram` | boolean | The message is from any Hologram entity webhook |
| `keyword_match` | boolean | The message matched one of this entity's configured trigger keywords |
| `interaction_type` | string | Verb set by `/trigger <entity> <verb>` or the `trigger_entity` tool (e.g. `"drink"`, `"eat"`, `"open"`). Empty string if not triggered. |

### Timing

| Variable | Type | Description |
|----------|------|-------------|
| `response_ms` | number | Milliseconds since this entity last responded in the channel |
| `retry_ms` | number | Milliseconds since the triggering message (only non-zero during `$retry` re-evaluation) |
| `idle_ms` | number | Milliseconds since any message in the channel |
| `unread_count` | number | Number of messages since this entity's last reply |

### Time of day

| Variable | Type | Description |
|----------|------|-------------|
| `time.hour` | number | Current hour, 0–23 (server local time) |
| `time.is_day` | boolean | `true` if hour is 6–17 (6am to 6pm) |
| `time.is_night` | boolean | `true` if hour is 0–5 or 18–23 (6pm to 6am) |

### Entity and channel

| Variable | Type | Description |
|----------|------|-------------|
| `name` | string | This entity's name |
| `chars` | string[] | Names of all entities bound to this channel |
| `group` | string | Comma-separated names of all bound entities |
| `self.*` | varies | This entity's `key: value` facts parsed into typed values (see [Self Context](#self-context)) |

### Channel

| Variable | Type | Description |
|----------|------|-------------|
| `channel.id` | string | Channel snowflake ID |
| `channel.name` | string | Channel name |
| `channel.description` | string | Channel topic/description |
| `channel.is_nsfw` | boolean | Whether the channel is marked NSFW |
| `channel.type` | string | `"text"`, `"vc"`, `"thread"`, `"forum"`, `"announcement"`, `"dm"`, `"category"`, `"directory"`, `"media"` |
| `channel.mention` | string | Channel mention string (e.g. `<#123456789>`) |

### Server

| Variable | Type | Description |
|----------|------|-------------|
| `server.id` | string | Server snowflake ID |
| `server.name` | string | Server name |
| `server.description` | string | Server description |
| `server.nsfw_level` | string | `"default"`, `"explicit"`, `"safe"`, or `"age_restricted"` |

### Self Context

Facts written in `key: value` format are parsed and available as `self.<key>`. Values are typed automatically:

- `true` / `false` → boolean
- Numbers like `42` or `3.14` → number
- Everything else → string

```
mood: happy
energy: 0.8
$if self.energy > 0.5 && self.mood == "happy": $respond
```

Keys must match the pattern `[a-zA-Z_][a-zA-Z0-9_]*`. Facts with `$if` prefixes are skipped when building `self`.

## Regex Patterns

The methods `.match()`, `.search()`, `.replace()`, and `.split()` accept a **string literal** pattern that is compiled into a `RegExp`. You cannot use a variable as a pattern — the pattern must be a literal string in the expression source.

```
# Correct
$if content.match("\\bhello\\b"): $respond

# Wrong — dynamic patterns are not allowed
$if content.match(name): $respond
```

Patterns are validated at compile time to prevent ReDoS (catastrophic backtracking). The validator is a structural parser, not a runtime timeout — invalid patterns are rejected with an error message before the expression runs.

### What is allowed

| Feature | Example | Notes |
|---------|---------|-------|
| Literals | `"hello"` | Exact text match |
| Dot | `"a.b"` | Match any character |
| Anchors | `"^hello$"` | Start/end of string |
| Word boundary | `"\\b"` | Word edge (zero-width) |
| Alternation | `"cat\|dog"` | Match either branch |
| Character classes | `"[a-z]"`, `"[^0-9]"` | Sets and negated sets |
| Shorthand classes | `"\\d"`, `"\\w"`, `"\\s"` | Digit, word char, whitespace |
| Negated shorthands | `"\\D"`, `"\\W"`, `"\\S"` | Inverse shorthands |
| Escape sequences | `"\\t"`, `"\\n"`, `"\\r"` | Tab, newline, carriage return |
| Escaped specials | `"\\."`, `"\\\\"`, `"\\+"` | Literal `.`, `\`, `+`, etc. |
| Simple quantifiers | `"a+"`, `"b*"`, `"c?"` | One-or-more, zero-or-more, optional |
| Brace quantifiers | `"a{3}"`, `"a{1,5}"`, `"a{2,}"` | Exact, range, minimum |
| Lazy quantifiers | `"a+?"`, `"b*?"` | Non-greedy |
| Non-capturing groups | `"(?:ab)+"` | Group without capture |

### What is blocked

| Feature | Example | Why |
|---------|---------|-----|
| Capturing groups | `"(abc)"` | Causes backtracking — use `(?:abc)` instead |
| Nested quantifiers | `"(?:a+)+"` | Catastrophic backtracking |
| Backreferences | `"\\1"` | Exponential matching time |
| Lookahead | `"(?=abc)"` | Not allowed |
| Negative lookahead | `"(?!abc)"` | Not allowed |
| Lookbehind | `"(?<=abc)"` | Not allowed |
| Negative lookbehind | `"(?<!abc)"` | Not allowed |
| Named groups | `"(?<name>abc)"` | Use `(?:abc)` instead |
| Patterns over 500 characters | — | Maximum length limit |
| Dynamic (variable) patterns | `content.match(name)` | Must be a string literal |

### The nested quantifier rule

The core safety rule: **a quantifier cannot apply to an expression that already contains a quantifier**. This is the primary source of ReDoS.

```
a+b+c+        ✓  (separate atoms, each quantified once)
(?:ab)+        ✓  (group with no inner quantifiers)
(?:a+)         ✓  (quantifier inside group, no outer quantifier)
(?:a+)+        ✗  (outer + on a group that already contains +)
(?:a+b*)+      ✗  (outer + on a group containing + and *)
```

To work around the rule, flatten the pattern. Instead of `(?:a{3}){3}`, write `a{9}`.

### Escaping in string literals

Patterns are written as expression strings, not regex literals. Backslashes must be doubled:

```
$if content.match("\\d+"):       # \d+ in the regex
$if content.match("\\bword\\b"): # \bword\b in the regex
$if content.match("\\.")):       # \. (literal dot) in the regex
```

### Common patterns

```
$if content.match("\\d+"): contains numbers
$if content.match("\\bhello\\b"): word boundary match
$if content.search("https?://[^\\s]+") >= 0: contains URL
$if content.split("\\s+").length > 5: more than 5 words
$if content.match("[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+"): looks like email
```

## Sandbox Restrictions

The expression evaluator is a sandboxed custom parser — it does not run arbitrary JavaScript. Restrictions that are enforced:

**Variable access**: Only identifiers listed in [Context Variables](#context-variables) are accessible. Any other identifier name produces an `Unknown identifier` error at compile time.

**Property access**: Only dot notation (`.property`) is supported. Bracket notation (`obj["key"]`) is not parsed. The following property names are blocked on any object to prevent prototype chain escapes:

- `.constructor`
- `.__proto__`
- `.prototype`
- `.__defineGetter__` / `.__defineSetter__`
- `.__lookupGetter__` / `.__lookupSetter__`

**No globals**: `Math`, `JSON`, `Object`, `Array`, `console`, `fetch`, `process`, `globalThis`, and all other browser/Node globals are inaccessible. There is no scope chain — the evaluator only has the context object.

**No side effects**: There is no assignment operator. Expressions cannot modify state.

**No `new`**: The `new` keyword is not part of the expression grammar. Use `Date.new(...)` for date construction.

**String/array output limits**: Methods that can produce large outputs (`repeat`, `padStart`, `padEnd`, `replaceAll`, `join`) are capped at 100,000 characters. Exceeding the limit throws an error.

**Regex patterns**: Must be string literals — no dynamic patterns. Patterns are validated before the expression runs (see [Regex Patterns](#regex-patterns)).

::: tip Keep expressions simple
If you find yourself hitting sandbox restrictions, consider whether the logic belongs in a template (`{% if %}` blocks) or in entity facts rather than a single expression.
:::
