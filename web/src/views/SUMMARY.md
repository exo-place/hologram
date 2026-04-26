## web/src/views/

Top-level page views, each corresponding to a route in the SolidJS router.

- **EntityList.tsx / .css** — Searchable, debounced list of all entities. Provides create and delete dialogs. Navigates to the entity detail view on selection.
- **EntityDetail.tsx / .css** — Tabbed entity detail page with six tabs: Facts, Config, Template, System Prompt, Memories, and Permissions. Hosts `FactEditor`, `ConfigEditor`, `TemplateEditor` (×2), `MemoriesPanel`, and `PermissionsEditor` components. Supports inline entity rename.
- **Chat.tsx / .css** — Web chat interface. Features: channel sidebar (create/delete/edit dialogs); SSE-powered real-time message streaming with typing indicators (per-entity avatar + name); optimistic message rendering; persona selector (send as an entity); forget button (exclude history before now from AI context); trigger button (fire entity responses without a user message). Rich message rendering via `ChatMessage`. Channels are created with a name and a set of bound entity IDs.
- **Debug.tsx / .css** — Debug inspection panel with four tabs: Bindings (entity–channel binding graph), Errors (fact evaluation errors), Embeddings (embedding coverage per entity), and Trace (per-entity fact evaluation trace with channel context).
- **Login.tsx / .css** — Discord OAuth login page. Shows a "Sign in with Discord" button linking to `/api/auth/discord/login`. Used as a landing page for unauthenticated users who try to access auth-gated moderation features.
- **Mutes.tsx / .css** — Active mute management. Lists all active mutes with scope/ID/expiry/reason columns. Supports creating new mutes (all scope types, duration choices) and removing individual mutes via the REST API (`/api/mutes`). Requires Discord OAuth login.
- **Audit.tsx / .css** — Moderation event log. Filterable by event type (rate_limited, muted, unmuted, channel/guild disabled/enabled, config_changed) and time range. Shows actor, target, and parsed JSON details per event. Requires Discord OAuth login.
