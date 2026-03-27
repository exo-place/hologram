import {
  createSignal,
  createResource,
  Show,
  For,
  onCleanup,
  batch,
} from "solid-js";
import { channels, entities, type ApiMessage } from "../api/client";
import { subscribeSSE, type SSESubscription } from "../api/sse";
import ChatMessage from "../components/ChatMessage";
import "./Chat.css";

export default function Chat() {
  const [channelList, { refetch: refetchChannels }] = createResource(channels.list);
  const [activeId, setActiveId] = createSignal<string | null>(null);
  const [messages, setMessages] = createSignal<ApiMessage[]>([]);
  const [streamingContent, setStreamingContent] = createSignal<string | null>(null);
  const [streamingMeta, setStreamingMeta] = createSignal<Omit<ApiMessage, "content"> | null>(null);
  const [sending, setSending] = createSignal(false);
  const [input, setInput] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [loadingMessages, setLoadingMessages] = createSignal(false);

  // Create channel dialog
  const [showCreate, setShowCreate] = createSignal(false);
  const [newName, setNewName] = createSignal("");
  const [creating, setCreating] = createSignal(false);
  const [createError, setCreateError] = createSignal<string | null>(null);
  const [allEntities] = createResource(() => entities.list({ limit: 200 }));
  const [selectedEntityIds, setSelectedEntityIds] = createSignal<number[]>([]);

  let messagesEndRef!: HTMLDivElement;
  let inputRef!: HTMLTextAreaElement;
  let sseRef: SSESubscription | null = null;

  function scrollToBottom() {
    requestAnimationFrame(() => messagesEndRef?.scrollIntoView({ behavior: "smooth" }));
  }

  async function selectChannel(id: string) {
    sseRef?.close();
    sseRef = null;
    setStreamingContent(null);
    setStreamingMeta(null);
    setActiveId(id);
    setLoadingMessages(true);
    setError(null);
    try {
      const msgs = await channels.listMessages(id, 100);
      setMessages(msgs);
      scrollToBottom();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingMessages(false);
    }

    // Subscribe to SSE stream
    sseRef = subscribeSSE(id, (event) => {
      const type = event.type as string;
      if (type === "text_delta") {
        setStreamingContent((prev) => (prev ?? "") + (event.text as string ?? ""));
      } else if (type === "message_start") {
        setStreamingContent("");
        setStreamingMeta({
          id: -1,
          channel_id: id,
          author_id: String(event.author_id ?? ""),
          author_name: String(event.author_name ?? ""),
          discord_message_id: null,
          data: null,
          created_at: new Date().toISOString(),
        });
      } else if (type === "message_complete") {
        batch(() => {
          // Server sends the stored message when available; fall back to reconstructing from meta
          const stored = event.message as ApiMessage | undefined;
          if (stored) {
            setMessages((prev) => [...prev, stored]);
          } else {
            const meta = streamingMeta();
            const content = streamingContent();
            if (meta && content !== null) {
              const completed: ApiMessage = { ...meta, content, id: Date.now() };
              setMessages((prev) => [...prev, completed]);
            }
          }
          setStreamingContent(null);
          setStreamingMeta(null);
        });
        scrollToBottom();
      }
    });
  }

  onCleanup(() => {
    sseRef?.close();
  });

  async function send() {
    const text = input().trim();
    if (!text || !activeId()) return;
    setSending(true);
    setError(null);
    const optimistic: ApiMessage = {
      id: Date.now(),
      channel_id: activeId()!,
      author_id: "web-user",
      author_name: "You",
      content: text,
      discord_message_id: null,
      data: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setInput("");
    scrollToBottom();
    try {
      await channels.sendMessage(activeId()!, {
        content: text,
        author_id: "web-user",
        author_name: "You",
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setSending(false);
    }
  }

  function openCreate() {
    setShowCreate(true);
    setNewName("");
    setSelectedEntityIds([]);
    setCreateError(null);
  }

  function toggleEntity(id: number) {
    setSelectedEntityIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function createChannel() {
    if (selectedEntityIds().length === 0) {
      setCreateError("Select at least one entity");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const ch = await channels.create({
        name: newName().trim() || undefined,
        entity_ids: selectedEntityIds(),
      });
      setShowCreate(false);
      await refetchChannels();
      selectChannel(ch.id);
    } catch (err) {
      setCreateError(String(err));
    } finally {
      setCreating(false);
    }
  }

  async function deleteChannel(id: string, e: MouseEvent) {
    e.stopPropagation();
    await channels.delete(id);
    if (activeId() === id) {
      setActiveId(null);
      setMessages([]);
    }
    refetchChannels();
  }

  return (
    <div class="chat">
      {/* Sidebar */}
      <div class="chat__sidebar">
        <div class="chat__sidebar-header row">
          <span class="small" style="font-weight:600">Channels</span>
          <div class="spacer" />
          <button class="btn btn--primary btn--sm" onClick={openCreate}>+ New</button>
        </div>
        <Show when={channelList.loading}>
          <p class="dim small" style="padding:8px">Loading…</p>
        </Show>
        <Show when={!channelList.loading && channelList()?.length === 0}>
          <p class="dim small" style="padding:8px">No channels yet.</p>
        </Show>
        <ul class="chat__channel-list">
          <For each={channelList()}>
            {(ch) => (
              <li
                class={`chat__channel-item${activeId() === ch.id ? " chat__channel-item--active" : ""}`}
                onClick={() => selectChannel(ch.id)}
              >
                <span class="chat__channel-name">{ch.name || ch.id}</span>
                <button
                  class="btn btn--ghost btn--icon chat__channel-delete"
                  onClick={(e) => deleteChannel(ch.id, e)}
                  title="Delete"
                >
                  ×
                </button>
              </li>
            )}
          </For>
        </ul>
      </div>

      {/* Main */}
      <div class="chat__main">
        <Show when={!activeId()}>
          <div class="chat__empty">
            <p class="dim">Select or create a channel to start chatting.</p>
          </div>
        </Show>

        <Show when={activeId()}>
          <>
            <div class="chat__messages">
              <Show when={loadingMessages()}>
                <p class="dim small" style="padding:16px">Loading…</p>
              </Show>
              <For each={messages()}>
                {(msg) => <ChatMessage message={msg} />}
              </For>
              <Show when={streamingContent() !== null && streamingMeta()}>
                {() => {
                  const meta = streamingMeta()!;
                  return (
                    <ChatMessage
                      message={{ ...meta, content: streamingContent()!, id: -1 }}
                      isStreaming
                      streamContent={streamingContent()!}
                    />
                  );
                }}
              </Show>
              <div ref={messagesEndRef} />
            </div>

            <Show when={error()}>
              <p class="error chat__error">{error()}</p>
            </Show>

            <div class="chat__input-area">
              <textarea
                ref={inputRef}
                class="input input--mono chat__input"
                value={input()}
                placeholder="Type a message… (Ctrl+Enter to send)"
                rows={3}
                onInput={(e) => setInput(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.ctrlKey) send();
                }}
              />
              <button class="btn btn--primary" onClick={send} disabled={sending() || !input().trim()}>
                {sending() ? "Sending…" : "Send"}
              </button>
            </div>
          </>
        </Show>
      </div>

      {/* Create dialog */}
      <Show when={showCreate()}>
        <div class="overlay" onClick={() => setShowCreate(false)}>
          <div class="dialog card" onClick={(e) => e.stopPropagation()}>
            <h3 class="dialog__title">New Channel</h3>
            <input
              class="input"
              value={newName()}
              onInput={(e) => setNewName(e.currentTarget.value)}
              placeholder="Channel name (optional)"
              autofocus
            />
            <p class="small" style="margin:8px 0 4px;font-weight:600">Entities</p>
            <div class="chat__entity-picker">
              <Show when={allEntities.loading}>
                <p class="dim small">Loading…</p>
              </Show>
              <For each={allEntities()}>
                {(e) => (
                  <label class="chat__entity-option">
                    <input
                      type="checkbox"
                      checked={selectedEntityIds().includes(e.id)}
                      onChange={() => toggleEntity(e.id)}
                    />
                    <span class="small">{e.name}</span>
                  </label>
                )}
              </For>
            </div>
            <Show when={createError()}>
              <p class="error">{createError()}</p>
            </Show>
            <div class="row" style="margin-top:12px">
              <button class="btn" onClick={() => setShowCreate(false)}>Cancel</button>
              <button class="btn btn--primary" onClick={createChannel} disabled={creating()}>
                {creating() ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
