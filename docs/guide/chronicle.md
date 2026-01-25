# Chronicle

The chronicle is Hologram's persistent memory system - perspective-aware facts and events.

## Entry Types

| Type | Description |
|------|-------------|
| `event` | Something that happened |
| `fact` | Learned information |
| `dialogue` | Important conversation |
| `thought` | Character's internal state |
| `note` | Meta/OOC notes |
| `summary` | Consolidated summary |

## Visibility

Entries have visibility that controls who knows what:

- **public** - Everyone knows (world events, public actions)
- **character** - Only specific character knows (thoughts, private observations)
- **secret** - Only narrator/GM knows (hidden plot points)

## Commands

```
/chronicle remember <content>    # Add a memory
/chronicle recall <query>        # Search memories (RAG)
/chronicle history [limit]       # Recent memories
/chronicle view <id>             # View specific memory
/chronicle forget <id>           # Remove memory
```

## Auto-Extraction

When enabled, Hologram automatically extracts memories from conversations:

- Explicit markers: ` ```memory ``` ` blocks
- Heuristic extraction: Important events/facts
- LLM-based: AI identifies what to remember

Configure extraction:
```
/config set chronicle.autoExtract true
/config set chronicle.extractImportance 6
```

## RAG Search

Chronicle entries are embedded for semantic search. When assembling context, relevant memories are retrieved based on the current conversation.
