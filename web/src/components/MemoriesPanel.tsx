import { createSignal, createResource, Show, For } from "solid-js";
import { entities } from "../api/client";
import "./MemoriesPanel.css";

export default function MemoriesPanel(props: { entityId: number }) {
  const [memories, { mutate }] = createResource(() => props.entityId, entities.listMemories);
  const [error, setError] = createSignal<string | null>(null);
  const [addingNew, setAddingNew] = createSignal(false);
  const [newContent, setNewContent] = createSignal("");
  const [saving, setSaving] = createSignal(false);

  let newRef!: HTMLTextAreaElement;

  function startAdd() {
    setAddingNew(true);
    setNewContent("");
    requestAnimationFrame(() => newRef?.focus());
  }

  async function commitNew() {
    if (!newContent().trim()) return;
    setSaving(true);
    setError(null);
    try {
      const mem = await entities.addMemory(props.entityId, { content: newContent().trim() });
      mutate((prev) => [...(prev ?? []), mem]);
      setAddingNew(false);
      setNewContent("");
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  async function deleteMemory(id: number) {
    setError(null);
    try {
      await entities.deleteMemory(props.entityId, id);
      mutate((prev) => prev?.filter((m) => m.id !== id));
    } catch (err) {
      setError(String(err));
    }
  }

  function formatFrecency(frecency: number) {
    if (frecency >= 1000) return `${(frecency / 1000).toFixed(1)}k`;
    return String(frecency);
  }

  return (
    <div class="memories-panel">
      <div class="memories-panel__toolbar row">
        <span class="dim small">{memories()?.length ?? 0} memories</span>
        <div class="spacer" />
        <button class="btn btn--primary btn--sm" onClick={startAdd}>+ Add memory</button>
      </div>

      <Show when={error()}>
        <p class="error">{error()}</p>
      </Show>
      <Show when={memories.loading}>
        <p class="dim small">Loading…</p>
      </Show>
      <Show when={!memories.loading && memories()?.length === 0}>
        <p class="dim small">No memories yet.</p>
      </Show>

      <ul class="memories-panel__list">
        <For each={memories()}>
          {(mem) => (
            <li class="memories-panel__item card">
              <div class="memories-panel__content mono small">{mem.content}</div>
              <div class="memories-panel__meta row">
                <span class="dim small">frecency {formatFrecency(mem.frecency)}</span>
                <Show when={mem.source_channel_id}>
                  <span class="dim small">· ch {mem.source_channel_id}</span>
                </Show>
                <div class="spacer" />
                <button
                  class="btn btn--ghost btn--icon memories-panel__delete"
                  title="Delete"
                  onClick={() => deleteMemory(mem.id)}
                >
                  ×
                </button>
              </div>
            </li>
          )}
        </For>

        <Show when={addingNew()}>
          <li class="memories-panel__item memories-panel__item--editing card">
            <textarea
              ref={newRef}
              class="input input--mono memories-panel__textarea"
              value={newContent()}
              onInput={(e) => setNewContent(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.ctrlKey) commitNew();
                if (e.key === "Escape") setAddingNew(false);
              }}
              placeholder="Enter memory…"
              rows={3}
            />
            <div class="memories-panel__actions row">
              <span class="dim small">Ctrl+Enter to save</span>
              <div class="spacer" />
              <button class="btn" onClick={() => setAddingNew(false)}>Cancel</button>
              <button class="btn btn--primary" onClick={commitNew} disabled={saving()}>
                {saving() ? "Saving…" : "Save"}
              </button>
            </div>
          </li>
        </Show>
      </ul>
    </div>
  );
}
