# src/ai/

LLM integration layer. Handles everything from prompt construction to streaming delivery, multimodal attachments, and provider-agnostic model routing. All entity evaluation results flow through here before reaching the Discord layer.

## Key Files

- `handler.ts` — `handleMessage()`: the main non-streaming LLM call. Builds prompt, calls the AI SDK, tracks tool usage (add/update/remove fact and memory), strips name prefixes, parses multi-entity responses. Returns `ResponseResult | null`.
- `streaming.ts` — `handleMessageStreaming()`: streaming equivalent of `handler.ts`. Emits typed `StreamEvent`s (`delta`, `line`, `char_start`, `char_end`, etc.) consumed by the bot's webhook delivery loop.
- `prompt.ts` — `preparePromptContext()`: expands `{{entity:ID}}` and other macros, resolves user persona, retrieves message history, and calls the template engine to produce the final system prompt + message array sent to the LLM.
- `template.ts` — Nunjucks template engine with runtime security patches (blocked prototype traversal, loop iteration cap, output size cap). Implements `send_as` macro, template inheritance (`{% extends %}`), and renders `DEFAULT_TEMPLATE` from `src/templates/default.njk`.
- `context.ts` — Core types (`MessageContext`, `EvaluatedEntity`) and message-normalisation helpers (provider-specific role mapping, strip-pattern application, `applyStripPatterns`, `normalizeMessagesForProvider`).
- `models.ts` — Provider-agnostic model routing via `provider:model` spec strings. Maps 17 AI SDK providers. Also provides `buildThinkingOptions`, `buildSafetyOptions`, vision/document capability detection, model allowlist enforcement, and the `InferenceError` class.
- `tools.ts` — `createTools()` factory: AI SDK tool definitions for `add_fact`, `update_fact`, `remove_fact`, `save_memory`, `update_memory`, `remove_memory`. Enforces `$locked` permission checks before any mutation.
- `parsing.ts` — Name-prefix stripping for single and multi-entity responses (`stripNamePrefix`, `parseNamePrefixResponse`). Also handles streaming name-prefix detection via sentinel characters.
- `attachments.ts` — Resolves HATT attachment markers embedded in messages to `ImagePart`/`FilePart`/text-fallback content parts, routing by provider capability. Uses `attachment-cache` for fetched bytes.
- `embeddings.ts` — Local embedding model (Transformers.js, 384-dim). `embed()`, `cosineSimilarity()`, `similarityMatrix()`, `maxSimilarityMatrix()`. Used by the memory retrieval pipeline.

## Notes

- Entities sharing the same template (including `null` = default) are grouped into one LLM call.
- Entities with different templates receive separate LLM calls.
- The HATT marker protocol (`<<<HATT:{nonce}|url|mimeType>>>`) is the mechanism for passing attachment metadata through the Nunjucks template into the message array.
