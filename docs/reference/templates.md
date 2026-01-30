# Custom Templates

Custom templates let you control the system prompt formatting for an entity. By default, entities use the built-in `buildSystemPrompt()` formatting. A custom template replaces this entirely.

## Editing

```
/edit <entity> type:Template
```

Submit an empty template to clear it and revert to default formatting.

## Syntax

Nunjucks-compatible subset:

```
{{ expr }}                                    — expression output (via expr.ts sandbox)
{% if expr %}...{% elif expr %}...{% else %}...{% endif %}
{% for var in expr %}...{% endfor %}
{# comment #}
```

No macros, imports, includes, extends, set, or filters.

## Template Context

All standard expression context variables are available (see `ExprContext`), plus:

| Variable | Type | Description |
|----------|------|-------------|
| `entities` | `Array<{id, name, facts}>` | Responding entities (facts as `string[]`) |
| `others` | `Array<{id, name, facts}>` | Other referenced entities (facts as `string[]`) |
| `memories` | `Record<number, string[]>` | Entity ID to memory strings |
| `entity_names` | `string` | Comma-separated names of responding entities |
| `freeform` | `boolean` | True if any entity has `$freeform` |

### For-loop Variables

Inside `{% for %}` blocks, additional variables are available:

| Variable | Description |
|----------|-------------|
| `loop.index` | 0-based index |
| `loop.index0` | 0-based index (alias) |
| `loop.index1` | 1-based index |
| `loop.first` | True for first iteration |
| `loop.last` | True for last iteration |
| `loop.length` | Total number of items |

## Example

```
{# Custom system prompt template #}
{% for entity in entities %}
You are {{ entity.name }}.

{% for fact in entity.facts %}
- {{ fact }}
{% endfor %}

{% if memories[entity.id] %}
Memories:
{% for memory in memories[entity.id] %}
- {{ memory }}
{% endfor %}
{% endif %}
{% endfor %}

{% for other in others %}
{{ other.name }} is nearby.
{% for fact in other.facts %}
- {{ fact }}
{% endfor %}
{% endfor %}

{% if freeform %}
Write naturally with all characters.
{% endif %}
```

## Limits

- **Loop iterations:** 1000 per for-loop
- **Output size:** 1MB maximum
- **Expressions:** All expressions go through expr.ts sandbox (same security as `$if` conditions)

## Grouping Behavior

Entities with different templates get **separate LLM calls**. Entities with the same template (including null/default) share a call as before. This prevents one entity's template from controlling how another entity's facts are presented.

## Known Limitations

Templates are per-entity and control the entire system prompt. A template on one entity could manipulate how other entities' facts are presented **in the same LLM call** (when entities share the same template). Mitigation:

- Template-based grouping separates entities with different templates
- Only the entity owner/editors can set a template (same permission model as facts)
- Entities sharing a template are presumed to be managed by the same owner
