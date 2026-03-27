import { createSignal, createResource, createEffect, Show } from "solid-js";
import { entities } from "../api/client";
import "./ConfigEditor.css";

const STREAM_MODES = ["", "sentence", "word", "token"];

export default function ConfigEditor(props: { entityId: number }) {
  const [config, { mutate }] = createResource(() => props.entityId, entities.getConfig);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [saved, setSaved] = createSignal(false);

  // Local editable state — populated once from the resource, then user-controlled
  const [model, setModel] = createSignal("");
  const [context, setContext] = createSignal("");
  const [streamMode, setStreamMode] = createSignal("");
  const [avatar, setAvatar] = createSignal("");
  const [memory, setMemory] = createSignal("");
  const [thinking, setThinking] = createSignal("");
  const [freeform, setFreeform] = createSignal(false);
  const [initialised, setInitialised] = createSignal(false);

  // Sync once when config first loads (or when entityId changes and resets initialised)
  createEffect(() => {
    const c = config();
    if (c && !initialised()) {
      setModel(c.config_model ?? "");
      setContext(c.config_context ?? "");
      setStreamMode(c.config_stream_mode ?? "");
      setAvatar(c.config_avatar ?? "");
      setMemory(c.config_memory ?? "");
      setThinking(c.config_thinking ?? "");
      setFreeform(c.config_freeform === 1);
      setInitialised(true);
    }
  });

  // Reset initialised when entityId changes so the effect re-runs
  createEffect(() => {
    void props.entityId; // track entityId to reset on change
    setInitialised(false);
  });

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await entities.patchConfig(props.entityId, {
        config_model: model() || null,
        config_context: context() || null,
        config_stream_mode: streamMode() || null,
        config_avatar: avatar() || null,
        config_memory: memory() || null,
        config_thinking: thinking() || null,
        config_freeform: freeform() ? 1 : 0,
      });
      mutate(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="config-editor">
      <Show when={config.loading}>
        <p class="dim small">Loading…</p>
      </Show>
      <Show when={config.error}>
        <p class="error">{String(config.error)}</p>
      </Show>
      <Show when={initialised()}>
        <div class="config-editor__form">
          <div class="config-editor__field">
            <label class="config-editor__label small">Model</label>
            <input
              class="input config-editor__input"
              placeholder="provider:model (blank = default)"
              value={model()}
              onInput={(e) => setModel(e.currentTarget.value)}
            />
          </div>

          <div class="config-editor__field">
            <label class="config-editor__label small">Context expression</label>
            <input
              class="input input--mono config-editor__input"
              placeholder="e.g. channel_id == '123'"
              value={context()}
              onInput={(e) => setContext(e.currentTarget.value)}
            />
          </div>

          <div class="config-editor__field">
            <label class="config-editor__label small">Stream mode</label>
            <select
              class="input config-editor__select"
              value={streamMode()}
              onChange={(e) => setStreamMode(e.currentTarget.value)}
            >
              {STREAM_MODES.map((m) => (
                <option value={m}>{m || "(default)"}</option>
              ))}
            </select>
          </div>

          <div class="config-editor__field">
            <label class="config-editor__label small">Avatar URL</label>
            <input
              class="input config-editor__input"
              placeholder="https://…"
              value={avatar()}
              onInput={(e) => setAvatar(e.currentTarget.value)}
            />
          </div>

          <div class="config-editor__field">
            <label class="config-editor__label small">Memory scope</label>
            <input
              class="input input--mono config-editor__input"
              placeholder="e.g. guild_id == '123' (blank = all)"
              value={memory()}
              onInput={(e) => setMemory(e.currentTarget.value)}
            />
          </div>

          <div class="config-editor__field">
            <label class="config-editor__label small">Thinking level</label>
            <input
              class="input config-editor__input"
              placeholder="minimal / low / medium / high (blank = default)"
              value={thinking()}
              onInput={(e) => setThinking(e.currentTarget.value)}
            />
          </div>

          <div class="config-editor__field config-editor__field--inline">
            <input
              id="freeform-toggle"
              type="checkbox"
              class="config-editor__checkbox"
              checked={freeform()}
              onChange={(e) => setFreeform(e.currentTarget.checked)}
            />
            <label for="freeform-toggle" class="config-editor__label small">
              Freeform (skip response parsing)
            </label>
          </div>

          <Show when={error()}>
            <p class="error">{error()}</p>
          </Show>

          <div class="config-editor__actions row">
            <Show when={saved()}>
              <span class="success small">Saved</span>
            </Show>
            <div class="spacer" />
            <button class="btn btn--primary" onClick={save} disabled={saving()}>
              {saving() ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}
