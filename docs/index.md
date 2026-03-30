---
layout: home

hero:
  name: Hologram
  text: Collaborative Worldbuilding
  tagline: A Discord bot where everything is an entity with facts
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/exo-place/hologram

features:
  - icon: 🎭
    title: Everything is an Entity
    details: Characters, locations, items, factions — all entities with attached facts. No rigid schemas, just freeform descriptions that the LLM reasons over.
  - icon: 🔗
    title: Simple Bindings
    details: Bind channels to entities for AI responses. Bind yourself to a persona to speak as different characters. Scope to a channel, server, or globally.
  - icon: ⚡
    title: Conditional Logic
    details: Use $if expressions for random effects, time-based behavior, @mention triggers, and dynamic facts evaluated at message time.
  - icon: 🧠
    title: Custom Templates
    details: Override the system prompt with Nunjucks templates. Control message roles, inject memory, and share templates between entities via inheritance.
  - icon: 🤖
    title: 16+ LLM Providers
    details: Google, Anthropic, OpenAI, Groq, Mistral, xAI, and more. Per-entity model selection, thinking level control, streaming, and image generation.
  - icon: 🛠️
    title: LLM Tool Calls
    details: Entities update their own facts in real time via tool calls — add, modify, or remove facts mid-conversation, with memories persisted separately from facts.
---

## Quick Example

```
Entity: Aria
Facts:
  - is a character
  - has silver hair and violet eyes
  - works as a traveling merchant
  - speaks with a slight accent
  - is cautious around strangers
  - $if mentioned: $respond
```

Bind Aria to a channel, and she'll respond in character. Facts are freeform — the LLM reasons over them directly.

## Conditional Facts

```
Entity: The Void Shrine
Facts:
  - is an ancient place of power
  - $if time.is_night: hums with eldritch energy
  - $if time.is_night && random() < 0.2: $respond
  - $if unread_count > 5: something stirs in the silence
```

Facts can be conditional. The shrine only chimes in at night, and only occasionally.

## Custom Templates

```nunjucks
{% call send_as("system") %}
You are {{ char.name }}. Today is {{ time.date }}.
{% endcall %}

{% call send_as("user") %}
{{ char.name }}'s facts:
{% for fact in char.facts %}
- {{ fact }}
{% endfor %}
{% endcall %}
```

Nunjucks templates give full control over the system prompt: message roles, entity references, memory injection, and template inheritance.

## Getting Started

1. **Create a character**: `/create Aria`
2. **Add personality**: `/edit Aria` → Add facts describing who Aria is
3. **Bind to channel**: `/bind channel Aria`
4. **Chat**: Just talk — Aria responds in character

[Read the full guide →](/guide/getting-started)
