import { createSignal, createResource, Show, Switch, Match, For } from "solid-js";
import { useParams, A } from "@solidjs/router";
import { entities } from "../api/client";
import FactEditor from "../components/FactEditor";
import ConfigEditor from "../components/ConfigEditor";
import TemplateEditor from "../components/TemplateEditor";
import MemoriesPanel from "../components/MemoriesPanel";
import "./EntityDetail.css";

type Tab = "Facts" | "Config" | "Template" | "System Prompt" | "Memories";
const TABS: Tab[] = ["Facts", "Config", "Template", "System Prompt", "Memories"];

export default function EntityDetail() {
  const params = useParams();
  const [tab, setTab] = createSignal<Tab>("Facts");
  const [renamingName, setRenamingName] = createSignal(false);
  const [nameInput, setNameInput] = createSignal("");

  const [entity, { mutate }] = createResource(() => Number(params.id), entities.get);

  let inputRef!: HTMLInputElement;

  function startRename() {
    if (!entity()) return;
    setNameInput(entity()!.name);
    setRenamingName(true);
    requestAnimationFrame(() => { inputRef?.focus(); inputRef?.select(); });
  }

  async function saveRename() {
    if (!entity() || !renamingName()) return;
    setRenamingName(false);
    const trimmed = nameInput().trim();
    if (!trimmed || trimmed === entity()!.name) return;
    try {
      const updated = await entities.rename(entity()!.id, { name: trimmed });
      mutate((prev) => prev ? { ...prev, ...updated } : prev);
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div class="entity-detail">
      <Show when={entity.loading}>
        <p class="dim small" style="padding:24px">Loading…</p>
      </Show>
      <Show when={entity.error}>
        <p class="error" style="padding:24px">{String(entity.error)}</p>
      </Show>
      <Show when={entity()}>
        {(e) => (
          <>
            <div class="entity-detail__header row">
              <A href="/entities" class="entity-detail__back dim small">← Entities</A>
              <Show
                when={!renamingName()}
                fallback={
                  <input
                    ref={inputRef}
                    class="entity-detail__rename-input"
                    value={nameInput()}
                    onInput={(ev) => setNameInput(ev.currentTarget.value)}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter") saveRename();
                      if (ev.key === "Escape") setRenamingName(false);
                    }}
                    onBlur={saveRename}
                  />
                }
              >
                <h2 class="entity-detail__title" onDblClick={startRename}>{e().name}</h2>
              </Show>
              <span class="dim small">id {e().id}</span>
            </div>

            <div class="tabs" style="padding:0 24px">
              <For each={TABS}>
                {(t) => (
                  <button
                    class={`tabs__tab${tab() === t ? " tabs__tab--active" : ""}`}
                    onClick={() => setTab(t)}
                  >
                    {t}
                  </button>
                )}
              </For>
            </div>

            <div class="entity-detail__content">
              <Switch>
                <Match when={tab() === "Facts"}>
                  <FactEditor entityId={e().id} />
                </Match>
                <Match when={tab() === "Config"}>
                  <ConfigEditor entityId={e().id} />
                </Match>
                <Match when={tab() === "Template"}>
                  <TemplateEditor entityId={e().id} type="template" label="Custom Template" />
                </Match>
                <Match when={tab() === "System Prompt"}>
                  <TemplateEditor entityId={e().id} type="system-template" label="System Prompt Template" />
                </Match>
                <Match when={tab() === "Memories"}>
                  <MemoriesPanel entityId={e().id} />
                </Match>
              </Switch>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}
