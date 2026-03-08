# src/debug/

Debug and introspection utilities. All functions return structured data and have no Discord dependencies — they are shared between the CLI debug tool (`scripts/debug.ts`) and the in-Discord `/debug` slash command variants.

## Key Files

- `index.ts` — Re-exports everything from the three sub-modules. The single import point for consumers.
- `evaluation.ts` — Fact evaluation tracing. `buildEvaluatedEntity` constructs an `EvaluatedEntity` from a DB entity using a mock `ExprContext` (suitable for debug display, may omit live values like `unread_count`). `traceFacts` returns a per-fact trace showing which `$if` conditions passed or failed and why. `simulateResponse` does a dry-run prompt build without an LLM call.
- `state.ts` — DB state inspection. `getBindingGraph` (all discord_entities rows), `getMemoryStats` (per-entity memory counts, frecency stats, embedding coverage), `getEvalErrors` (deduped error notifications from `eval_errors`), `getActiveEffectsDebug` (unexpired effects), `getMessageStats` (per-channel message counts).
- `embeddings.ts` — RAG and embedding inspection. `getEmbeddingStatus` (model loaded, dimensions, cache stats), `getEmbeddingCoverage` (fraction of facts/memories that have embeddings), `testRagRetrieval` (run a query against an entity's memories and return ranked results with similarity scores), `testEmbed` / `testSimilarity` (latency benchmarks).

## Notes

- `buildEvaluatedEntity` is also called by Discord slash commands (`/debug prompt`, `/debug context`) — adding new `ExprContext` fields requires updating the mock context here as well.
- All functions are pure (no side effects, no Discord API calls) to keep them testable and reusable.
