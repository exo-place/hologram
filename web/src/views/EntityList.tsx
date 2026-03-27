import { createSignal, createResource, Show, For } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { entities, type ApiEntity } from "../api/client";
import "./EntityList.css";

export default function EntityList() {
  const navigate = useNavigate();
  const [query, setQuery] = createSignal("");
  const [debouncedQuery, setDebouncedQuery] = createSignal("");
  let debounceTimer: ReturnType<typeof setTimeout>;

  const [list, { refetch }] = createResource(debouncedQuery, (q) =>
    entities.list({ q: q || undefined, limit: 200 })
  );

  function onInput(e: InputEvent) {
    const val = (e.target as HTMLInputElement).value;
    setQuery(val);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => setDebouncedQuery(val), 200);
  }

  // Create dialog
  const [showCreate, setShowCreate] = createSignal(false);
  const [newName, setNewName] = createSignal("");
  const [createError, setCreateError] = createSignal<string | null>(null);
  const [creating, setCreating] = createSignal(false);

  async function onCreate() {
    if (!newName().trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const e = await entities.create({ name: newName().trim() });
      setShowCreate(false);
      setNewName("");
      navigate(`/entities/${e.id}`);
    } catch (err) {
      setCreateError(String(err));
    } finally {
      setCreating(false);
    }
  }

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = createSignal<ApiEntity | null>(null);
  const [deleting, setDeleting] = createSignal(false);

  async function onDelete() {
    const target = deleteTarget();
    if (!target) return;
    setDeleting(true);
    try {
      await entities.delete(target.id);
      setDeleteTarget(null);
      refetch();
    } catch (err) {
      console.error(err);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div class="entity-list">
      <div class="entity-list__header row">
        <h2 class="entity-list__title">Entities</h2>
        <div class="spacer" />
        <button class="btn btn--primary" onClick={() => setShowCreate(true)}>+ New</button>
      </div>

      <div class="entity-list__search">
        <input
          class="input"
          value={query()}
          onInput={onInput}
          placeholder="Search entities…"
        />
      </div>

      <Show when={list.error}>
        <p class="error">{String(list.error)}</p>
      </Show>
      <Show when={list.loading}>
        <p class="dim small">Loading…</p>
      </Show>
      <Show when={!list.loading && list()?.length === 0}>
        <p class="dim small">No entities found.</p>
      </Show>

      <Show when={list() && list()!.length > 0}>
        <ul class="entity-list__list">
          <For each={list()}>
            {(entity) => (
              <li class="entity-list__item card" onClick={() => navigate(`/entities/${entity.id}`)}>
                <span class="entity-list__name">{entity.name}</span>
                <span class="entity-list__id dim small">id {entity.id}</span>
                <button
                  class="btn btn--danger btn--sm"
                  onClick={(e) => { e.stopPropagation(); setDeleteTarget(entity); }}
                >
                  Delete
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>

      {/* Create dialog */}
      <Show when={showCreate()}>
        <div class="overlay" onClick={() => setShowCreate(false)}>
          <div class="dialog card" onClick={(e) => e.stopPropagation()}>
            <h3 class="dialog__title">New Entity</h3>
            <input
              class="input"
              value={newName()}
              onInput={(e) => setNewName(e.currentTarget.value)}
              placeholder="Name"
              onKeyDown={(e) => e.key === "Enter" && onCreate()}
              autofocus
            />
            <Show when={createError()}>
              <p class="error">{createError()}</p>
            </Show>
            <div class="row">
              <button class="btn" onClick={() => setShowCreate(false)}>Cancel</button>
              <button class="btn btn--primary" onClick={onCreate} disabled={creating()}>
                {creating() ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* Delete dialog */}
      <Show when={deleteTarget()}>
        <div class="overlay" onClick={() => setDeleteTarget(null)}>
          <div class="dialog card" onClick={(e) => e.stopPropagation()}>
            <h3 class="dialog__title">Delete "{deleteTarget()!.name}"?</h3>
            <p class="dim small">This cannot be undone. All facts, memories, and bindings will be removed.</p>
            <div class="row">
              <button class="btn" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button class="btn btn--danger" onClick={onDelete} disabled={deleting()}>
                {deleting() ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
