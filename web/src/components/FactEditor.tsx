import { createSignal, createResource, Show, For } from "solid-js";
import { entities, type ApiFact } from "../api/client";
import "./FactEditor.css";

export default function FactEditor(props: { entityId: number }) {
  const [facts, { mutate }] = createResource(() => props.entityId, entities.listFacts);
  const [editingId, setEditingId] = createSignal<number | null>(null);
  const [editContent, setEditContent] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [addingNew, setAddingNew] = createSignal(false);
  const [newContent, setNewContent] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);

  let editRef!: HTMLTextAreaElement;
  let newRef!: HTMLTextAreaElement;

  function startEdit(fact: ApiFact) {
    setEditingId(fact.id);
    setEditContent(fact.content);
    requestAnimationFrame(() => editRef?.focus());
  }

  function cancelEdit() {
    setEditingId(null);
    setEditContent("");
  }

  async function saveFact(id: number) {
    if (!editContent().trim()) return;
    setSaving(true);
    try {
      const updated = await entities.updateFact(props.entityId, id, { content: editContent() });
      mutate((prev) => prev?.map((f) => (f.id === id ? updated : f)));
      setEditingId(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  async function deleteFact(id: number) {
    try {
      await entities.deleteFact(props.entityId, id);
      mutate((prev) => prev?.filter((f) => f.id !== id));
    } catch (err) {
      setError(String(err));
    }
  }

  async function commitNew() {
    if (!newContent().trim()) return;
    setSaving(true);
    try {
      const fact = await entities.addFact(props.entityId, { content: newContent().trim() });
      mutate((prev) => [...(prev ?? []), fact]);
      setAddingNew(false);
      setNewContent("");
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  function startAdd() {
    setAddingNew(true);
    setNewContent("");
    requestAnimationFrame(() => newRef?.focus());
  }

  return (
    <div class="fact-editor">
      <div class="fact-editor__toolbar row">
        <span class="dim small">{facts()?.length ?? 0} facts</span>
        <div class="spacer" />
        <button class="btn btn--primary btn--sm" onClick={startAdd}>+ Add fact</button>
      </div>

      <Show when={error()}>
        <p class="error">{error()}</p>
      </Show>
      <Show when={facts.loading}>
        <p class="dim small">Loading…</p>
      </Show>

      <ul class="fact-editor__list">
        <For each={facts()}>
          {(fact) => (
            <li class={`fact-editor__item${editingId() === fact.id ? " fact-editor__item--editing" : ""}`}>
              <Show
                when={editingId() === fact.id}
                fallback={
                  <>
                    <span class="fact-editor__content mono small" onClick={() => startEdit(fact)}>
                      {fact.content}
                    </span>
                    <button class="btn btn--ghost btn--icon" title="Edit" onClick={() => startEdit(fact)}>✎</button>
                    <button class="btn btn--ghost btn--icon fact-editor__delete" title="Delete" onClick={() => deleteFact(fact.id)}>×</button>
                  </>
                }
              >
                <textarea
                  ref={editRef}
                  class="input input--mono fact-editor__textarea"
                  value={editContent()}
                  onInput={(e) => setEditContent(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.ctrlKey) saveFact(fact.id);
                    if (e.key === "Escape") cancelEdit();
                  }}
                  rows={3}
                />
                <div class="fact-editor__actions row">
                  <span class="dim small">Ctrl+Enter to save</span>
                  <div class="spacer" />
                  <button class="btn" onClick={cancelEdit}>Cancel</button>
                  <button class="btn btn--primary" onClick={() => saveFact(fact.id)} disabled={saving()}>
                    {saving() ? "Saving…" : "Save"}
                  </button>
                </div>
              </Show>
            </li>
          )}
        </For>

        <Show when={addingNew()}>
          <li class="fact-editor__item fact-editor__item--editing">
            <textarea
              ref={newRef}
              class="input input--mono fact-editor__textarea"
              value={newContent()}
              onInput={(e) => setNewContent(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.ctrlKey) commitNew();
                if (e.key === "Escape") setAddingNew(false);
              }}
              placeholder="Enter fact…"
              rows={3}
            />
            <div class="fact-editor__actions row">
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
