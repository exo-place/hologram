# Tool Calls Reference

Hologram gives the LLM a set of tools it can call during a response. These let entities modify their own facts, save memories, and control whether they respond.

Tools are available when the model supports tool calling. Models without tool support still work — they just can't modify entities or save memories during conversation.

## Facts vs Memories

The distinction matters because facts and memories serve different purposes:

| | Facts | Memories |
|---|---|---|
| **What** | Permanent defining traits | Events and experiences |
| **Examples** | "has silver hair", "is loyal to the queen" | "promised to meet at the tavern tomorrow", "learned the king's secret" |
| **Persistence** | Always shown to the LLM | Retrieved by relevance to current conversation |
| **When to use** | Core identity, appearance, abilities, relationships | Conversations, promises, discoveries, things that happened |
| **Tools** | `add_fact`, `update_fact`, `remove_fact` | `save_memory`, `update_memory`, `remove_memory` |

**Rule of thumb:** If it defines *what something is*, it's a fact. If it describes *what happened*, it's a memory.

## Fact Tools

### `add_fact`

Add a permanent defining trait to an entity.

| Parameter | Type | Description |
|-----------|------|-------------|
| `entityId` | number | The entity ID to add the fact to |
| `content` | string | The fact content |

The LLM should use this sparingly — only for core personality, appearance, abilities, or key relationships. Most interactions don't need new facts.

**Example use cases:**
- A character gains a new ability or title
- A transformation changes physical traits (see [Body Descriptions & Transformations](/reference/facts#body-descriptions-transformations))
- A location gains a new permanent feature

### `update_fact`

Update an existing fact when a core defining trait changes.

| Parameter | Type | Description |
|-----------|------|-------------|
| `entityId` | number | The entity ID |
| `oldContent` | string | The exact current fact text to match |
| `newContent` | string | The new fact content |

The `oldContent` must match an existing fact exactly. If it doesn't match, the update fails silently.

**Example use cases:**
- "has short brown hair" → "has long brown hair" (after time passes)
- "is in The Tavern" → "is in The Market" (location change)
- "is cautious around strangers" → "is friendly and outgoing" (character development)

### `remove_fact`

Remove a permanent defining trait that is no longer true.

| Parameter | Type | Description |
|-----------|------|-------------|
| `entityId` | number | The entity ID |
| `content` | string | The exact fact text to remove |

Like `update_fact`, the content must match exactly.

**Example use cases:**
- An item is consumed or destroyed
- A relationship ends
- A transformation removes a trait entirely

## Memory Tools

### `save_memory`

Save a memory of something that happened.

| Parameter | Type | Description |
|-----------|------|-------------|
| `entityId` | number | The entity ID |
| `content` | string | The memory content — what happened or was learned |

Memories are retrieved by semantic similarity to the current conversation. The LLM should use this for significant conversations, promises, or events that shaped the entity. Most interactions don't need saving — only what matters long-term.

Memories automatically track which channel and server they were created in.

**Example use cases:**
- A character makes a promise to another
- Something important is revealed in conversation
- A significant event occurs during roleplay

### `update_memory`

Update an existing memory when details change or need correction.

| Parameter | Type | Description |
|-----------|------|-------------|
| `entityId` | number | The entity ID |
| `oldContent` | string | The exact current memory text to match |
| `newContent` | string | The new memory content |

### `remove_memory`

Remove a memory that is no longer relevant or was incorrect.

| Parameter | Type | Description |
|-----------|------|-------------|
| `entityId` | number | The entity ID |
| `content` | string | The exact memory text to remove |

## Response Control

### `skip_response`

Explicitly choose not to respond to a message.

| Parameter | Type | Description |
|-----------|------|-------------|
| `reason` | string? | Optional reason for not responding |

Use when the conversation doesn't require the entity's input, the entity would just be adding noise, or when it's better to stay quiet.

::: info
`skip_response` is distinct from `$respond false`. The `$respond` directive prevents the LLM from being called at all. `skip_response` is a tool the LLM calls *during* generation when it decides mid-response that silence is better.
:::

## Locking

The [`$locked` directive](/reference/directives#locked) controls whether tools can modify an entity.

### Entity-level lock

```
$locked
```

Blocks all tool calls that modify this entity: `add_fact`, `update_fact`, `remove_fact`, `save_memory`, `update_memory`, `remove_memory`. The LLM can still *see* all facts and memories — it just can't change them.

### Fact-level lock

```
$locked has silver hair
$locked is loyal to the queen
```

Locks specific facts from modification. The fact content (without the `$locked` prefix) is shown to the LLM normally. Tool calls targeting that specific fact via `update_fact` or `remove_fact` will fail with an error. Other facts on the same entity remain modifiable.

::: tip
Use entity-level `$locked` for characters that should never self-modify (narrators, system entities). Use fact-level `$locked` for protecting specific traits while allowing the LLM to modify everything else.
:::

## Error Handling

When a tool call fails (locked entity, no matching fact, etc.), the tool returns `{ success: false, error: "reason" }`. The LLM sees this response and can adjust — for example, it won't keep trying to modify a locked entity.
