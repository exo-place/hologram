import {
  createSignal,
  createMemo,
  createResource,
  Show,
  For,
  onCleanup,
  batch,
} from "solid-js";
import { channels, discordChannels, entities, type ApiMessage, type ApiDiscordChannel } from "../api/client";
import { subscribeSSE, type SSESubscription } from "../api/sse";
import ChatMessage from "../components/ChatMessage";
import "./Chat.css";

export default function Chat() {
  const [channelList, { refetch: refetchChannels }] = createResource(channels.list);
  const [discordChannelList] = createResource(discordChannels.list);
  const [activeId, setActiveId] = createSignal<string | null>(null);
  const [activeDiscordId, setActiveDiscordId] = createSignal<string | null>(null);
  const [messages, setMessages] = createSignal<ApiMessage[]>([]);
  const [streamingContent, setStreamingContent] = createSignal<string | null>(null);
  const [streamingMeta, setStreamingMeta] = createSignal<Omit<ApiMessage, "content"> | null>(null);
  const [typingEntities, setTypingEntities] = createSignal<Map<string, { name: string; avatarUrl: string | null }>>(new Map());
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
  const [personaId, setPersonaId] = createSignal<number | null>(null);

  // Edit channel dialog
  const [showEdit, setShowEdit] = createSignal(false);
  const [editName, setEditName] = createSignal("");
  const [editEntityIds, setEditEntityIds] = createSignal<number[]>([]);
  const [editError, setEditError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);

  // Delete confirm dialog
  const [showDeleteConfirm, setShowDeleteConfirm] = createSignal(false);
  const [deleteTargetId, setDeleteTargetId] = createSignal<string | null>(null);

  // Discord send persona (entity ID or custom name)
  const [discordEntityId, setDiscordEntityId] = createSignal<number | null>(null);
  const [discordCustomName, setDiscordCustomName] = createSignal("");

  const activeChannel = createMemo(() => channelList()?.find((c) => c.id === activeId()));
  const activeDiscordChannel = createMemo<ApiDiscordChannel | undefined>(() =>
    discordChannelList()?.find((c) => c.id === activeDiscordId())
  );

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
    setTypingEntities(new Map());
    setPersonaId(null);
    setActiveDiscordId(null);
    setActiveId(id);
    setLoadingMessages(true);
    setError(null);
    try {
      const msgs = await channels.listMessages(id, 100);
      setMessages([...msgs].reverse());
      scrollToBottom();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingMessages(false);
    }

    // Subscribe to SSE stream
    sseRef = subscribeSSE(id, (event) => {
      const type = event.type as string;
      if (type === "typing") {
        setTypingEntities((prev) => {
          const next = new Map(prev);
          next.set(String(event.author_id ?? ""), { name: String(event.author_name ?? ""), avatarUrl: event.avatar_url as string | null ?? null });
          return next;
        });
      } else if (type === "text_delta") {
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
      } else if (type === "forget") {
        const id = activeId();
        if (id) {
          channels.listMessages(id, 100).then((msgs) => setMessages([...msgs].reverse())).catch(() => {});
        }
      } else if (type === "message_complete") {
        batch(() => {
          // Server sends the stored message when available; fall back to reconstructing from meta
          const stored = event.message as ApiMessage | undefined;
          const authorId = stored?.author_id ?? (streamingMeta()?.author_id ?? "");
          setTypingEntities((prev) => {
            if (!prev.has(authorId)) return prev;
            const next = new Map(prev);
            next.delete(authorId);
            return next;
          });
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

  async function selectDiscordChannel(id: string) {
    sseRef?.close();
    sseRef = null;
    setStreamingContent(null);
    setStreamingMeta(null);
    setTypingEntities(new Map());
    setDiscordEntityId(null);
    setDiscordCustomName("");
    setActiveId(null);
    setActiveDiscordId(id);
    setLoadingMessages(true);
    setError(null);
    try {
      const msgs = await discordChannels.listMessages(id, 100);
      setMessages([...msgs].reverse());
      scrollToBottom();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingMessages(false);
    }
    // SSE for real-time (bot will broadcast when it receives Discord messages)
    sseRef = subscribeSSE(
      id,
      (event) => {
        const type = event.type as string;
        if (type === "message") {
          const msg = event.message as ApiMessage | undefined;
          if (msg) setMessages((prev) => [...prev, msg]);
          scrollToBottom();
        }
      },
      undefined,
      `/api/discord-channels/${id}/stream`,
    );
  }

  onCleanup(() => {
    sseRef?.close();
  });

  async function send() {
    const text = input().trim();
    if (!text || !activeId()) return;
    setSending(true);
    setError(null);
    const persona = personaId() ? allEntities()?.find((e) => e.id === personaId()) : null;
    const authorId = persona ? `entity:${persona.id}` : "web-user";
    const authorName = persona ? persona.name : "You";
    const optimistic: ApiMessage = {
      id: Date.now(),
      channel_id: activeId()!,
      author_id: authorId,
      author_name: authorName,
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
        author_id: authorId,
        author_name: authorName,
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setSending(false);
    }
  }

  async function forget() {
    const id = activeId();
    if (!id) return;
    await channels.forget(id);
    const msgs = await channels.listMessages(id, 100);
    setMessages([...msgs].reverse());
  }

  async function trigger() {
    const id = activeId();
    if (!id) return;
    await channels.trigger(id);
  }

  function openCreate() {
    setShowCreate(true);
    setNewName("");
    setSelectedEntityIds([]);
    setCreateError(null);
  }

  function openEdit() {
    const ch = activeChannel();
    if (!ch) return;
    setEditName(ch.name ?? "");
    setEditEntityIds([...ch.entity_ids]);
    setEditError(null);
    setShowEdit(true);
  }

  function toggleEditEntity(id: number) {
    setEditEntityIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function saveEdit() {
    const id = activeId();
    if (!id) return;
    setSaving(true);
    setEditError(null);
    try {
      await channels.update(id, {
        name: editName().trim() || null,
        entity_ids: editEntityIds(),
      });
      setShowEdit(false);
      await refetchChannels();
    } catch (err) {
      setEditError(String(err));
    } finally {
      setSaving(false);
    }
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

  function promptDeleteChannel(id: string, e: MouseEvent) {
    e.stopPropagation();
    setDeleteTargetId(id);
    setShowDeleteConfirm(true);
  }

  async function confirmDeleteChannel() {
    const id = deleteTargetId();
    if (!id) return;
    setShowDeleteConfirm(false);
    setDeleteTargetId(null);
    await channels.delete(id);
    if (activeId() === id) {
      setActiveId(null);
      setMessages([]);
    }
    refetchChannels();
  }

  async function sendToDiscord() {
    const text = input().trim();
    const discordId = activeDiscordId();
    if (!text || !discordId) return;
    setSending(true);
    setError(null);
    setInput("");
    try {
      const entityId = discordEntityId();
      const customName = discordCustomName().trim();
      await discordChannels.sendMessage(discordId, {
        content: text,
        entity_id: entityId ?? undefined,
        author_name: !entityId && customName ? customName : undefined,
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
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
                  onClick={(e) => promptDeleteChannel(ch.id, e)}
                  title="Delete"
                >
                  ×
                </button>
              </li>
            )}
          </For>
        </ul>
        <Show when={discordChannelList.loading || (discordChannelList()?.length ?? 0) > 0}>
          <div class="chat__sidebar-section">
            <div class="chat__sidebar-header row">
              <span class="small" style="font-weight:600">Discord</span>
            </div>
            <Show when={discordChannelList.loading}>
              <p class="dim small" style="padding:8px">Loading…</p>
            </Show>
            <ul class="chat__channel-list">
              <For each={discordChannelList()}>
                {(ch) => (
                  <li
                    class={`chat__channel-item${activeDiscordId() === ch.id ? " chat__channel-item--active" : ""}`}
                    onClick={() => selectDiscordChannel(ch.id)}
                    title={ch.entity_names.join(", ")}
                  >
                    <span class="chat__channel-name">
                      {ch.name
                        ? `#${ch.name}`
                        : (ch.entity_names.slice(0, 2).join(", ") + (ch.entity_names.length > 2 ? ` +${ch.entity_names.length - 2}` : ""))}
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </Show>
      </div>

      {/* Main */}
      <div class="chat__main">
        <Show when={!activeId() && !activeDiscordId()}>
          <div class="chat__empty">
            <p class="dim">Select or create a channel to start chatting.</p>
          </div>
        </Show>

        <Show when={activeId() || activeDiscordId()}>
          <>
            <div class="chat__header">
              <span class="chat__header-name">
                {activeDiscordId()
                  ? (activeDiscordChannel()?.name ? `#${activeDiscordChannel()!.name}` : (activeDiscordChannel()?.entity_names.join(", ") ?? activeDiscordId()))
                  : (channelList()?.find((c) => c.id === activeId())?.name ?? activeId())}
              </span>
              <div class="chat__header-entities">
                <Show when={activeDiscordId()}>
                  <span class="chat__header-entity chat__header-entity--discord">Discord</span>
                </Show>
                <Show when={activeId()}>
                  <For each={activeChannel()?.entity_ids.flatMap((id) => {
                    const e = allEntities()?.find((a) => a.id === id);
                    return e ? [e] : [];
                  }) ?? []}>
                    {(e) => <span class="chat__header-entity">{e.name}</span>}
                  </For>
                </Show>
              </div>
              <div class="chat__header-actions">
                <Show when={activeId()}>
                  <button class="btn btn--ghost btn--sm" onClick={openEdit} title="Edit channel">
                    Edit
                  </button>
                  <button class="btn btn--sm" onClick={forget} title="Forget messages before now">
                    Forget
                  </button>
                  <button class="btn btn--sm btn--primary" onClick={trigger} title="Trigger entity response">
                    Trigger
                  </button>
                </Show>
              </div>
            </div>

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
              <Show when={typingEntities().size > 0}>
                <div class="chat__typing-row">
                  <For each={[...typingEntities().values()]}>
                    {(entity) => (
                      <div class="chat-typing-indicator">
                        <span class="chat-typing-indicator__name">{entity.name}</span>
                        <span class="chat-typing-indicator__dots">
                          <span /><span /><span />
                        </span>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
              <div ref={messagesEndRef} />
            </div>

            <Show when={error()}>
              <p class="error chat__error">{error()}</p>
            </Show>

            <Show when={activeDiscordId()}>
              <div class="chat__input-area">
                <div class="chat__persona-row">
                  <label class="chat__persona-label small dim">Send as:</label>
                  <select
                    class="input input--sm chat__persona-select"
                    value={discordEntityId() ?? ""}
                    onChange={(e) => setDiscordEntityId(e.currentTarget.value ? Number(e.currentTarget.value) : null)}
                  >
                    <option value="">Anonymous / Custom</option>
                    <For each={activeDiscordChannel()?.entity_ids.flatMap((id) => {
                      const e = allEntities()?.find((a) => a.id === id);
                      return e ? [e] : [];
                    }) ?? []}>
                      {(e) => <option value={e.id}>{e.name}</option>}
                    </For>
                  </select>
                  <Show when={!discordEntityId()}>
                    <input
                      class="input input--sm"
                      style="flex:1"
                      value={discordCustomName()}
                      onInput={(e) => setDiscordCustomName(e.currentTarget.value)}
                      placeholder="Display name (optional)"
                    />
                  </Show>
                </div>
                <div class="chat__input-row">
                  <textarea
                    class="input input--mono chat__input"
                    value={input()}
                    placeholder="Type a message… (Ctrl+Enter to send)"
                    rows={3}
                    onInput={(e) => setInput(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.ctrlKey) sendToDiscord();
                    }}
                  />
                  <button class="btn btn--primary" onClick={sendToDiscord} disabled={sending() || !input().trim()}>
                    {sending() ? "Sending…" : "Send"}
                  </button>
                </div>
              </div>
            </Show>

            <Show when={activeId()}>
              <div class="chat__input-area">
                <div class="chat__persona-row">
                  <label class="chat__persona-label small dim">Speak as:</label>
                  <select
                    class="input input--sm chat__persona-select"
                    value={personaId() ?? ""}
                    onChange={(e) =>
                      setPersonaId(e.currentTarget.value ? Number(e.currentTarget.value) : null)
                    }
                  >
                    <option value="">You</option>
                    <For
                      each={
                        activeChannel()?.entity_ids.flatMap((id) => {
                          const e = allEntities()?.find((a) => a.id === id);
                          return e ? [e] : [];
                        }) ?? []
                      }
                    >
                      {(e) => <option value={e.id}>{e.name}</option>}
                    </For>
                  </select>
                </div>
                <div class="chat__input-row">
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
              </div>
            </Show>
          </>
        </Show>
      </div>

      {/* Delete confirm dialog */}
      <Show when={showDeleteConfirm()}>
        <div class="overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div class="dialog card" onClick={(e) => e.stopPropagation()}>
            <h3 class="dialog__title">Delete Channel</h3>
            <p class="small dim">This will permanently delete the channel and its message history.</p>
            <div class="row" style="margin-top:12px">
              <button class="btn" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
              <button class="btn btn--danger" onClick={confirmDeleteChannel}>Delete</button>
            </div>
          </div>
        </div>
      </Show>

      {/* Edit channel dialog */}
      <Show when={showEdit()}>
        <div class="overlay" onClick={() => setShowEdit(false)}>
          <div class="dialog card" onClick={(e) => e.stopPropagation()}>
            <h3 class="dialog__title">Edit Channel</h3>
            <input
              class="input"
              value={editName()}
              onInput={(e) => setEditName(e.currentTarget.value)}
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
                      checked={editEntityIds().includes(e.id)}
                      onChange={() => toggleEditEntity(e.id)}
                    />
                    <span class="small">{e.name}</span>
                  </label>
                )}
              </For>
            </div>
            <Show when={editError()}>
              <p class="error">{editError()}</p>
            </Show>
            <div class="row" style="margin-top:12px">
              <button class="btn" onClick={() => setShowEdit(false)}>Cancel</button>
              <button class="btn btn--primary" onClick={saveEdit} disabled={saving()}>
                {saving() ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      </Show>

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
