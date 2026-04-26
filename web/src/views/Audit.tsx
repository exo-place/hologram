import { createSignal, createResource, For, Show } from "solid-js";
import { auditLog, type ApiModEvent } from "../api/client";
import "./Audit.css";

const EVENT_TYPE_OPTIONS = [
  { value: "", label: "All events" },
  { value: "rate_limited", label: "Rate limited" },
  { value: "muted", label: "Muted" },
  { value: "unmuted", label: "Unmuted" },
  { value: "channel_disabled", label: "Channel disabled" },
  { value: "channel_enabled", label: "Channel enabled" },
  { value: "guild_disabled", label: "Guild disabled" },
  { value: "guild_enabled", label: "Guild enabled" },
  { value: "config_changed", label: "Config changed" },
];

export default function Audit() {
  const [filterType, setFilterType] = createSignal("");
  const [filterHours, setFilterHours] = createSignal(24);

  const [events] = createResource(
    () => ({ event_type: filterType() || undefined, hours: filterHours() }),
    (params) => auditLog.list(params),
  );

  function formatDetails(raw: string | null): string {
    if (!raw) return "";
    try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
  }

  return (
    <div class="audit">
      <div class="audit__header">
        <h1 class="audit__title">Audit Log</h1>
        <div class="audit__filters">
          <select class="audit__select" value={filterType()} onChange={e => setFilterType((e.target as HTMLSelectElement).value)}>
            <For each={EVENT_TYPE_OPTIONS}>
              {opt => <option value={opt.value}>{opt.label}</option>}
            </For>
          </select>
          <select class="audit__select" value={String(filterHours())} onChange={e => setFilterHours(parseInt((e.target as HTMLSelectElement).value, 10))}>
            <option value="1">Last 1 hour</option>
            <option value="6">Last 6 hours</option>
            <option value="24">Last 24 hours</option>
            <option value="72">Last 3 days</option>
            <option value="168">Last 7 days</option>
          </select>
        </div>
      </div>

      <Show when={events.loading}>
        <div class="audit__loading">Loading…</div>
      </Show>

      <Show when={!events.loading && events()?.length === 0}>
        <div class="audit__empty">No events found for this filter.</div>
      </Show>

      <Show when={events() && events()!.length > 0}>
        <div class="audit__list">
          <For each={events()}>
            {(ev: ApiModEvent) => (
              <div class="audit__event">
                <div class="audit__event-row">
                  <span class={`audit__type-badge audit__type-badge--${ev.event_type.replace(/_/g, "-")}`}>
                    {ev.event_type}
                  </span>
                  <span class="audit__when">{ev.created_at}</span>
                  <Show when={ev.actor_id}>
                    <span class="audit__actor">by {ev.actor_id}</span>
                  </Show>
                  <Show when={!ev.actor_id}>
                    <span class="audit__actor audit__actor--system">system</span>
                  </Show>
                </div>
                <div class="audit__event-meta">
                  <Show when={ev.target_type}>
                    <span class="audit__meta-item">{ev.target_type}: <code>{ev.target_id}</code></span>
                  </Show>
                  <Show when={ev.channel_id}>
                    <span class="audit__meta-item">channel: <code>{ev.channel_id}</code></span>
                  </Show>
                  <Show when={ev.guild_id}>
                    <span class="audit__meta-item">guild: <code>{ev.guild_id}</code></span>
                  </Show>
                </div>
                <Show when={ev.details}>
                  <pre class="audit__details">{formatDetails(ev.details)}</pre>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
