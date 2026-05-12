# docs/.vitepress/playground/

Browser-runnable implementation of Hologram's fact evaluator and template engine, used by the interactive playground pages in `docs/playground/`.

## Key Files

- `fact-evaluator.ts` — Browser wrapper around `evaluateFacts()` from `src/logic/expr.ts`; compiles fact conditions and returns evaluated results
- `template-engine.ts` — Browser-compatible Nunjucks renderer that mirrors the production template pipeline
- `template-evaluator.ts` — Builds the template context (entities, memories, history, char, user) for playground rendering
- `shims/ai-context.ts` — Browser shim replacing Node/Bun-specific imports (e.g. DB access) with static playground data
- `languages/` — Monaco Monarch tokenizers for `.holo` fact syntax and Nunjucks template syntax
- `presets/` — Pre-built example sets for the fact playground (`fact-presets.ts`) and template playground (`template-presets.ts`)
- `components/` — Vue components: `FactPlayground.vue`, `TemplatePlayground.vue`, `PlaygroundEditor.vue`, `PlaygroundOutput.vue`, `PlaygroundPresets.vue`, `ContextEditor.vue`, `CopyButton.vue`

## Notes

- All production logic runs unmodified in the browser; only DB/Discord imports are shimmed.
- Monaco editor is loaded dynamically to avoid SSR issues with VitePress.
