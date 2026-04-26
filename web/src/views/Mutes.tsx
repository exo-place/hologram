import { createSignal, createResource, For, Show } from "solid-js";
import { moderation, type ApiMute } from "../api/client";
import "./Mutes.css";

export default function Mutes() {
  const [mutes, { refetch }] = createResource(() => moderation.listMutes());
  const [error, setError] = createSignal<string | null>(null);

  // Create mute form
  const [showCreate, setShowCreate] = createSignal(false);
  const [scopeType, setScopeType] = createSignal<ApiMute["scope_type"]>("entity");
  const [scopeId, setScopeId] = createSignal("");
  const [guildId, setGuildId] = createSignal("");
  const [expiresIn, setExpiresIn] = createSignal("1h");
  const [reason, setReason] = createSignal("");
  const [creating, setCreating] = createSignal(false);

  function expiresAt(): string | null {
    const durations: Record<string, number> = { "10m": 10 * 60, "1h": 3600, "1d": 86400 };
    const secs = durations[expiresIn()];
    if (!secs) return null;
    const d = new Date(Date.now() + secs * 1000);
    return d.toISOString().replace("T", " ").slice(0, 19);
  }

  async function onCreate() {
    if (!scopeId().trim()) return;
    setCreating(true);
    setError(null);
    try {
      await moderation.createMute({
        scope_type: scopeType(),
        scope_id: scopeId().trim(),
        guild_id: guildId().trim() || null,
        expires_at: expiresAt(),
        reason: reason().trim() || null,
      });
      setShowCreate(false);
      setScopeId("");
      setReason("");
      refetch();
    } catch (err) {
      setError(String(err));
    } finally {
      setCreating(false);
    }
  }

  async function onDelete(id: number) {
    try {
      await moderation.deleteMute(id);
      refetch();
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div class="mutes">
      <div class="mutes__header">
        <h1 class="mutes__title">Active Mutes</h1>
        <button class="mutes__btn mutes__btn--primary" onClick={() => setShowCreate(v => !v)}>
          + New Mute
        </button>
      </div>

      <Show when={error()}>
        <div class="mutes__error">{error()}</div>
      </Show>

      <Show when={showCreate()}>
        <div class="mutes__create">
          <h3 class="mutes__create-title">Create Mute</h3>
          <div class="mutes__form-row">
            <label class="mutes__label">Scope type</label>
            <select class="mutes__select" value={scopeType()} onChange={e => setScopeType((e.target as HTMLSelectElement).value as ApiMute["scope_type"])}>
              <option value="entity">Entity</option>
              <option value="owner">Owner</option>
              <option value="channel">Channel (kill switch)</option>
              <option value="guild">Guild (kill switch)</option>
            </select>
          </div>
          <div class="mutes__form-row">
            <label class="mutes__label">Scope ID (entity ID, user ID, channel ID, or guild ID)</label>
            <input class="mutes__input" type="text" value={scopeId()} onInput={e => setScopeId((e.target as HTMLInputElement).value)} placeholder="e.g. 42 or 123456789012345678" />
          </div>
          <div class="mutes__form-row">
            <label class="mutes__label">Guild ID (optional — restricts mute to a server)</label>
            <input class="mutes__input" type="text" value={guildId()} onInput={e => setGuildId((e.target as HTMLInputElement).value)} placeholder="Leave blank for global scope" />
          </div>
          <div class="mutes__form-row">
            <label class="mutes__label">Duration</label>
            <select class="mutes__select" value={expiresIn()} onChange={e => setExpiresIn((e.target as HTMLSelectElement).value)}>
              <option value="10m">10 minutes</option>
              <option value="1h">1 hour</option>
              <option value="1d">1 day</option>
              <option value="forever">Permanent</option>
            </select>
          </div>
          <div class="mutes__form-row">
            <label class="mutes__label">Reason (optional)</label>
            <input class="mutes__input" type="text" value={reason()} onInput={e => setReason((e.target as HTMLInputElement).value)} placeholder="e.g. cascade incident" />
          </div>
          <div class="mutes__form-actions">
            <button class="mutes__btn mutes__btn--primary" onClick={onCreate} disabled={creating()}>
              {creating() ? "Creating…" : "Create"}
            </button>
            <button class="mutes__btn" onClick={() => setShowCreate(false)}>Cancel</button>
          </div>
        </div>
      </Show>

      <Show when={mutes.loading}>
        <div class="mutes__loading">Loading…</div>
      </Show>

      <Show when={!mutes.loading && mutes()?.length === 0}>
        <div class="mutes__empty">No active mutes.</div>
      </Show>

      <Show when={mutes() && mutes()!.length > 0}>
        <table class="mutes__table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Scope</th>
              <th>Scope ID</th>
              <th>Guild</th>
              <th>Expires</th>
              <th>Reason</th>
              <th>By</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <For each={mutes()}>
              {(mute) => (
                <tr class="mutes__row">
                  <td class="mutes__cell mutes__cell--id">{mute.id}</td>
                  <td class="mutes__cell"><span class="mutes__scope-badge">{mute.scope_type}</span></td>
                  <td class="mutes__cell mutes__cell--mono">{mute.scope_id}</td>
                  <td class="mutes__cell mutes__cell--mono">{mute.guild_id ?? "—"}</td>
                  <td class="mutes__cell">{mute.expires_at ?? "permanent"}</td>
                  <td class="mutes__cell">{mute.reason ?? "—"}</td>
                  <td class="mutes__cell mutes__cell--mono">{mute.created_by}</td>
                  <td class="mutes__cell">
                    <button class="mutes__btn mutes__btn--danger mutes__btn--sm" onClick={() => onDelete(mute.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </div>
  );
}
