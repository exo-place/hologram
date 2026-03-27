import { createSignal, createResource, createEffect, Show, For, batch } from "solid-js";
import { entities } from "../api/client";
import type { ApiEntityConfig } from "../api/client";
import "./PermissionsEditor.css";

interface Props {
  entityId: number;
}

type PermKey = "config_view" | "config_edit" | "config_use" | "config_blacklist";

interface Section {
  key: PermKey;
  title: string;
  desc: string;
  hint: string;
  isBlacklist: boolean;
}

const SECTIONS: Section[] = [
  {
    key: "config_view",
    title: "View Access",
    desc: "Who can view this entity",
    hint: "Empty = everyone can view",
    isBlacklist: false,
  },
  {
    key: "config_edit",
    title: "Edit Access",
    desc: "Who can edit facts & config",
    hint: "Empty = everyone can edit",
    isBlacklist: false,
  },
  {
    key: "config_use",
    title: "Use Access",
    desc: "Who can use this entity in commands",
    hint: "Empty = everyone can use",
    isBlacklist: false,
  },
  {
    key: "config_blacklist",
    title: "Blacklist",
    desc: "Blocked from all interactions",
    hint: "Empty = no blacklist",
    isBlacklist: true,
  },
];

function parsePermList(raw: string | null | undefined, _isBlacklist: boolean): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === "@everyone") return [];
    if (Array.isArray(parsed)) return parsed as string[];
  } catch {
    // ignore parse errors
  }
  return [];
}

function serializePermList(lines: string[], isBlacklist: boolean): string | null {
  const entries = lines.map((l) => l.trim()).filter(Boolean);
  if (isBlacklist) return entries.length ? JSON.stringify(entries) : null;
  return entries.length ? JSON.stringify(entries) : JSON.stringify("@everyone");
}

export default function PermissionsEditor(props: Props) {
  const [config, { mutate }] = createResource(() => props.entityId, entities.getConfig);

  // Per-section text area state
  const [texts, setTexts] = createSignal<Record<PermKey, string>>({
    config_view: "",
    config_edit: "",
    config_use: "",
    config_blacklist: "",
  });

  // Per-section saving/saved/error state
  const [saving, setSaving] = createSignal<Record<PermKey, boolean>>({
    config_view: false,
    config_edit: false,
    config_use: false,
    config_blacklist: false,
  });
  const [saved, setSaved] = createSignal<Record<PermKey, boolean>>({
    config_view: false,
    config_edit: false,
    config_use: false,
    config_blacklist: false,
  });
  const [errors, setErrors] = createSignal<Record<PermKey, string | null>>({
    config_view: null,
    config_edit: null,
    config_use: null,
    config_blacklist: null,
  });

  const [initialised, setInitialised] = createSignal(false);

  // Sync once when config first loads (or when entityId changes)
  createEffect(() => {
    const c = config();
    if (c && !initialised()) {
      const init: Record<PermKey, string> = {
        config_view: "",
        config_edit: "",
        config_use: "",
        config_blacklist: "",
      };
      for (const section of SECTIONS) {
        const entries = parsePermList(c[section.key], section.isBlacklist);
        init[section.key] = entries.join("\n");
      }
      batch(() => {
        setTexts(init);
        setInitialised(true);
      });
    }
  });

  // Reset when entityId changes
  createEffect(() => {
    void props.entityId;
    setInitialised(false);
  });

  function setKeyText(key: PermKey, value: string) {
    setTexts((prev) => ({ ...prev, [key]: value }));
  }

  async function saveSection(section: Section) {
    const key = section.key;
    const lines = texts()[key].split("\n");
    const serialized = serializePermList(lines, section.isBlacklist);

    setSaving((prev) => ({ ...prev, [key]: true }));
    setErrors((prev) => ({ ...prev, [key]: null }));
    setSaved((prev) => ({ ...prev, [key]: false }));

    try {
      const patch: Partial<ApiEntityConfig> = { [key]: serialized };
      const updated = await entities.patchConfig(props.entityId, patch);
      mutate(updated);
      setSaved((prev) => ({ ...prev, [key]: true }));
      setTimeout(
        () => setSaved((prev) => ({ ...prev, [key]: false })),
        2000
      );
    } catch (err) {
      setErrors((prev) => ({ ...prev, [key]: String(err) }));
    } finally {
      setSaving((prev) => ({ ...prev, [key]: false }));
    }
  }

  return (
    <div class="perm-editor">
      <Show when={config.loading}>
        <p class="dim small">Loading…</p>
      </Show>
      <Show when={config.error}>
        <p class="error">{String(config.error)}</p>
      </Show>
      <Show when={initialised()}>
        <For each={SECTIONS}>
          {(section) => (
            <div class="perm-section">
              <div class="perm-section__header">
                <span class="perm-section__title">{section.title}</span>
                <span class="perm-section__desc">{section.desc}</span>
              </div>
              <textarea
                class="input input--mono perm-section__textarea"
                rows={4}
                placeholder="One entry per line: userId or role:roleId"
                value={texts()[section.key]}
                onInput={(e) => setKeyText(section.key, e.currentTarget.value)}
              />
              <div class="perm-section__footer">
                <span class="perm-section__hint">{section.hint}</span>
                <div class="row" style="gap:8px;align-items:center">
                  <Show when={errors()[section.key]}>
                    <span class="error small">{errors()[section.key]}</span>
                  </Show>
                  <Show when={saved()[section.key]}>
                    <span class="perm-section__saved">Saved</span>
                  </Show>
                  <button
                    class="btn btn--primary"
                    onClick={() => saveSection(section)}
                    disabled={saving()[section.key]}
                  >
                    {saving()[section.key] ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}
