import { createSignal, createResource, Show, For, Switch, Match } from "solid-js";
import { debug, type ApiEntityTrace } from "../api/client";
import "./Debug.css";

type Tab = "Bindings" | "Errors" | "Embeddings" | "Trace";
const TABS: Tab[] = ["Bindings", "Errors", "Embeddings", "Trace"];

export default function Debug() {
  const [tab, setTab] = createSignal<Tab>("Bindings");

  // Bindings tab
  const [bindings] = createResource(debug.bindings);

  // Errors tab
  const [errors] = createResource(() => debug.errors({ limit: 100 }));

  // Embeddings tab
  const [embStatus] = createResource(debug.embeddingStatus);

  // Trace tab
  const [traceEntityId, setTraceEntityId] = createSignal("");
  const [traceChannel, setTraceChannel] = createSignal("");
  const [traceResult, setTraceResult] = createSignal<ApiEntityTrace | null>(null);
  const [traceError, setTraceError] = createSignal<string | null>(null);
  const [tracing, setTracing] = createSignal(false);

  async function runTrace() {
    const id = parseInt(traceEntityId(), 10);
    if (isNaN(id)) return;
    setTracing(true);
    setTraceError(null);
    setTraceResult(null);
    try {
      const result = await debug.trace(id, traceChannel() || undefined);
      setTraceResult(result);
    } catch (err) {
      setTraceError(String(err));
    } finally {
      setTracing(false);
    }
  }

  return (
    <div class="debug-panel">
      <div class="debug-panel__header">
        <h2 class="debug-panel__title">Debug</h2>
      </div>

      <div class="tabs" style="padding: 0 24px">
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

      <div class="debug-panel__content">
        <Switch>
          <Match when={tab() === "Bindings"}>
            <Show when={bindings.loading}><p class="dim small">Loading…</p></Show>
            <Show when={bindings.error}><p class="error">{String(bindings.error)}</p></Show>
            <Show when={bindings()}>
              {(b) => (
                <>
                  <p class="dim small">{b().total} bindings total</p>
                  <table class="table">
                    <thead>
                      <tr>
                        <th>Discord ID</th>
                        <th>Type</th>
                        <th>Entity</th>
                        <th>Guild scope</th>
                        <th>Channel scope</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={b().bindings}>
                        {(binding) => (
                          <tr>
                            <td class="mono small">{binding.discord_id}</td>
                            <td class="small">{binding.discord_type}</td>
                            <td class="small">{binding.entity_name} <span class="dim">#{binding.entity_id}</span></td>
                            <td class="mono small dim">{binding.scope_guild_id ?? "—"}</td>
                            <td class="mono small dim">{binding.scope_channel_id ?? "—"}</td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </>
              )}
            </Show>
          </Match>

          <Match when={tab() === "Errors"}>
            <Show when={errors.loading}><p class="dim small">Loading…</p></Show>
            <Show when={errors.error}><p class="error">{String(errors.error)}</p></Show>
            <Show when={!errors.loading && errors()?.length === 0}>
              <p class="dim small">No eval errors recorded.</p>
            </Show>
            <Show when={errors() && errors()!.length > 0}>
              <div class="debug-panel__errors">
                <For each={errors()}>
                  {(e) => (
                    <div class="debug-panel__error-item card">
                      <div class="row">
                        <span class="small" style="font-weight:600">{e.entity_name}</span>
                        <span class="dim small">#{e.entity_id}</span>
                        <div class="spacer" />
                        <span class="dim small">{new Date(e.created_at).toLocaleString()}</span>
                      </div>
                      <Show when={e.condition}>
                        <code class="mono small debug-panel__condition">{e.condition}</code>
                      </Show>
                      <p class="error small" style="margin:0">{e.error_message}</p>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Match>

          <Match when={tab() === "Embeddings"}>
            <Show when={embStatus.loading}><p class="dim small">Loading…</p></Show>
            <Show when={embStatus.error}><p class="error">{String(embStatus.error)}</p></Show>
            <Show when={embStatus()}>
              {(s) => (
                <div class="debug-panel__embed-status">
                  <div class="debug-panel__stat card">
                    <span class="dim small">Model</span>
                    <span class="mono small">{s().model ?? "(none)"}</span>
                  </div>
                  <div class="debug-panel__stat card">
                    <span class="dim small">Facts</span>
                    <span>{s().embedded_facts} / {s().total_facts}</span>
                  </div>
                  <div class="debug-panel__stat card">
                    <span class="dim small">Memories</span>
                    <span>{s().embedded_memories} / {s().total_memories}</span>
                  </div>
                </div>
              )}
            </Show>
          </Match>

          <Match when={tab() === "Trace"}>
            <div class="debug-panel__trace-form row">
              <input
                class="input debug-panel__trace-input"
                placeholder="Entity ID"
                value={traceEntityId()}
                onInput={(e) => setTraceEntityId(e.currentTarget.value)}
                type="number"
              />
              <input
                class="input input--mono debug-panel__trace-channel"
                placeholder="Channel ID (optional)"
                value={traceChannel()}
                onInput={(e) => setTraceChannel(e.currentTarget.value)}
              />
              <button class="btn btn--primary" onClick={runTrace} disabled={tracing() || !traceEntityId()}>
                {tracing() ? "Tracing…" : "Trace"}
              </button>
            </div>

            <Show when={traceError()}>
              <p class="error">{traceError()}</p>
            </Show>

            <Show when={traceResult()}>
              {(r) => (
                <div class="debug-panel__trace-result">
                  <p class="small" style="margin-bottom:8px">
                    <strong>{r().entity_name}</strong> <span class="dim">#{r().entity_id}</span>
                    {" — "}{r().traces.length} facts
                  </p>
                  <table class="table">
                    <thead>
                      <tr>
                        <th>Fact</th>
                        <th>Category</th>
                        <th>Condition</th>
                        <th>Result</th>
                        <th>Included</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={r().traces}>
                        {(t) => (
                          <tr class={t.included ? "" : "debug-panel__row--excluded"}>
                            <td class="mono small">{t.raw}</td>
                            <td class="small dim">{t.category}</td>
                            <td class="mono small dim">{t.expression ?? "—"}</td>
                            <td class="small">{
                              t.error
                                ? <span class="error">{t.error}</span>
                                : t.result === null
                                  ? <span class="dim">—</span>
                                  : t.result
                                    ? <span class="success">✓</span>
                                    : <span class="dim">✗</span>
                            }</td>
                            <td class="small">{t.included ? "✓" : "—"}</td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              )}
            </Show>
          </Match>
        </Switch>
      </div>
    </div>
  );
}
