## web/src/components/

Reusable SolidJS components used across the entity detail view and chat.

- **ChatMessage.tsx / .css** — Single message bubble. Renders user vs bot messages with rich Discord-compatible content: inline markdown (bold, italic, code, links, Discord emoji), embeds (`EmbedCard`), image/video/file attachments (`AttachmentView`), stickers (`StickerView`), and v2 component containers (`ComponentView`). Accepts optional `isStreaming` / `streamContent` props for live token streaming. Entity authors link to their detail page.
- **ConfigEditor.tsx / .css** — Entity config form. Edits model, context window, streaming mode, avatar URL, memory window, thinking level, and freeform flag. Persists via `PATCH /api/entities/:id/config`.
- **FactEditor.tsx / .css** — Inline fact CRUD for an entity. Supports add, inline edit, and delete operations against the facts REST API.
- **MemoriesPanel.tsx / .css** — Memory list with add and delete. Displays all memories for an entity and provides a textarea-based add form.
- **MonacoEditor.tsx / .css** — Lightweight SolidJS wrapper around Monaco editor. Languages are registered once (singleton via `registerLanguages`). Editors are disposed on cleanup. Accepts `value`, `language` (`hologram` | `hologram-template`), and optional `onChange` callback.
- **PermissionsEditor.tsx / .css** — Per-section permissions editor for view, edit, use, and blacklist access controls. Each section is a textarea (one entry per line: userId or `role:roleId`). Serialises to JSON format expected by the API and saves each section independently via `PATCH /api/entities/:id/config`.
- **TemplateEditor.tsx / .css** — Monaco-based editor for per-entity Nunjucks templates. Handles both the main template (`template`) and the system template (`system-template`). Monaco is lazy-loaded to avoid blocking initial paint.
