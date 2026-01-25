# TODO

## Tech Debt

### Type Safety
- [ ] Replace `AnyBot` and `AnyInteraction` types with proper Discordeno types
  - Currently using `any` with eslint-disable as workaround for complex Discord types
  - Files affected: all command handlers in `src/bot/commands/`
  - Should use proper Bot and Interaction types from @discordeno/bot

### Test Coverage

Current: 296 tests across 15 files. Pure-logic modules tested:
- `src/ai/budget.ts` - token estimation, budget allocation
- `src/ai/context.ts` - message formatting, timestamp injection
- `src/ai/debug.ts` - context debugging, trace formatting, export
- `src/ai/extract.ts` - extraction prompt parsing
- `src/bot/webhooks.ts` - multi-char response parsing
- `src/chronicle/index.ts` - chronicle formatting, perspective filtering
- `src/config/defaults.ts` - config merging, presets
- `src/dice/index.ts` - dice parser (expressions, keep/drop, explode)
- `src/personas/index.ts` - persona context formatting
- `src/proxies/index.ts` - proxy matching (prefix/suffix/brackets)
- `src/relationships/index.ts` - affinity labels
- `src/state/index.ts` - outfit context formatting
- `src/wizards/index.ts` - wizard step flow, config-aware flow building
- `src/world/rng.ts` - seeded RNG determinism, distribution, dice notation
- `src/world/time.ts` - time math, calendar, periods, formatting

Remaining modules (DB-dependent, need mocking to test):
- [ ] `src/events/random.ts` - weighted selection, condition evaluation
- [ ] `src/events/behavior.ts` - state machine transitions
- [ ] `src/combat/index.ts` - initiative ordering, turn management
- [ ] `src/world/locations.ts` - location graph traversal, hierarchy
- [ ] `src/world/inventory.ts` - capacity checks, equipment slot validation
- [ ] `src/memory/graph.ts` - knowledge graph queries
- [ ] `src/ai/extraction-pipeline.ts` - explicit marker parsing, heuristic extraction

---

## Completed

All integration and feature work from Phases 1-7 is done:

- [x] Message handler integration (scene context, proxy, chronicle, extraction, multi-char)
- [x] Proxy webhook execution (creation, caching, DM fallback)
- [x] Config-aware item wizard (dynamic flows based on WorldConfig)
- [x] Random events system (tables, triggers, conditions, cooldowns, effects)
- [x] Real-time sync (auto-advancement, time-skip narration)
- [x] Inter-message timestamps (relative/absolute/calendar/both formats)
- [x] State extraction pipeline (explicit markers, heuristic, LLM-based)
- [x] Chronicle embeddings virtual table in schema
- [x] Perspective-based chronicle filtering for user queries
- [x] Deduplicate evaluateConditions into shared events/conditions.ts
- [x] Extract respond/editResponse/respondDeferred into shared commands/index.ts
