# docs/.vitepress/

VitePress configuration and custom theme for the Hologram documentation site.

## Key Files and Directories

- `config.ts` — VitePress site config: sidebar structure, nav, Vite aliases for playground, and Monaco editor integration
- `theme/` — Custom VitePress theme extending the default: `index.ts` (theme entry), `style.css` (playground-specific styles)
- `playground/` — Full interactive playground implementation (see `playground/SUMMARY.md`)
- `dist/` — Built output (gitignored)

## Notes

- The `@api` Vite alias points to `src/api/types.ts` so playground code can import shared request/response types.
- Monaco editor is loaded lazily to avoid blocking the initial page render.
