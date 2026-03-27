import { createSignal, createResource, Show, lazy } from "solid-js";
import { entities } from "../api/client";
import "./TemplateEditor.css";

// Monaco is heavy — load it lazily so it doesn't block initial page paint
const MonacoEditor = lazy(() => import("./MonacoEditor"));

interface Props {
  entityId: number;
  type: "template" | "system-template";
  label: string;
}

async function fetchTemplate(args: readonly [number, string]): Promise<string | null> {
  const [id, type] = args;
  if (type === "template") {
    const r = await entities.getTemplate(id);
    return r.template;
  } else {
    const r = await entities.getSystemTemplate(id);
    return r.system_template;
  }
}

export default function TemplateEditor(props: Props) {
  const [resource, { mutate }] = createResource(
    () => [props.entityId, props.type] as const,
    fetchTemplate,
  );

  const [content, setContent] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [saved, setSaved] = createSignal(false);
  const [initialised, setInitialised] = createSignal(false);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      if (props.type === "template") {
        await entities.setTemplate(props.entityId, content());
      } else {
        await entities.setSystemTemplate(props.entityId, content());
      }
      mutate(content());
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="template-editor">
      <Show when={resource.loading}>
        <p class="dim small">Loading…</p>
      </Show>
      <Show when={resource.error}>
        <p class="error">{String(resource.error)}</p>
      </Show>
      <Show when={!resource.loading && !resource.error}>
        {() => {
          if (!initialised()) {
            setContent(resource() ?? null);
            setInitialised(true);
          }
          const isCustom = content() !== null && content() !== "";
          const monacoLang = props.type === "template" ? "hologram-template" : "hologram-template";
          return (
            <>
              <div class="template-editor__toolbar row">
                <span class="dim small">
                  {isCustom ? "Custom template" : "Using default template"}
                </span>
                <div class="spacer" />
                <Show when={isCustom}>
                  <button
                    class="btn btn--ghost btn--sm"
                    onClick={() => setContent(null)}
                    title="Reset to default"
                  >
                    Reset to default
                  </button>
                </Show>
              </div>

              <div class="template-editor__editor">
                <MonacoEditor
                  value={content() ?? ""}
                  language={monacoLang}
                  onChange={(v) => setContent(v || null)}
                  minHeight={360}
                />
              </div>

              <Show when={error()}>
                <p class="error">{error()}</p>
              </Show>

              <div class="template-editor__actions row">
                <span class="dim small">Ctrl+S or Save button</span>
                <Show when={saved()}>
                  <span class="success small">Saved</span>
                </Show>
                <div class="spacer" />
                <button class="btn btn--primary" onClick={save} disabled={saving()}>
                  {saving() ? "Saving…" : "Save"}
                </button>
              </div>
            </>
          );
        }}
      </Show>
    </div>
  );
}
