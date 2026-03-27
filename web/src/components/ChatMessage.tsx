import { For, Show } from "solid-js";
import type { ApiMessage } from "../api/client";
import "./ChatMessage.css";

interface EmbedAuthorData { name: string; url?: string; icon_url?: string }
interface EmbedFooterData { text: string; icon_url?: string }
interface EmbedImageData { url: string; height?: number; width?: number }
interface EmbedFieldData { name: string; value: string; inline?: boolean }
interface EmbedData {
  title?: string; type?: string; description?: string; url?: string;
  timestamp?: number; color?: number; footer?: EmbedFooterData;
  image?: EmbedImageData; thumbnail?: EmbedImageData;
  author?: EmbedAuthorData; fields?: EmbedFieldData[];
}
interface AttachmentData {
  filename: string; url: string; content_type?: string;
  title?: string; size?: number; height?: number; width?: number; duration_secs?: number;
}
interface StickerData { id: string; name: string; format_type: number }
interface DiscordComponentData {
  type: number; id?: number; content?: string;
  accentColor?: number; accent_color?: number;
  spoiler?: boolean; components?: DiscordComponentData[];
}
interface MessageData {
  is_bot?: boolean; is_forward?: boolean;
  embeds?: EmbedData[]; stickers?: StickerData[];
  attachments?: AttachmentData[]; components?: DiscordComponentData[];
}

interface Props {
  message: ApiMessage;
  isStreaming?: boolean;
  streamContent?: string;
}

function renderMarkdown(text: string): string {
  // 1. Escape HTML entities
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  // 2. Discord subtext: -# text at start of line
  html = html.replace(/^-# (.+)$/gm, '<span class="chat-subtext">$1</span>');

  // 3. Bold: **text**
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // 4. Italic: *text* (but not **)
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");

  // 5. Inline code: `text`
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // 6. Links: [text](url)
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  // 7. Discord emoji (already HTML-escaped): &lt;:name:id&gt;
  html = html.replace(
    /&lt;:(\w+):(\d+)&gt;/g,
    '<img class="chat-emoji" src="https://cdn.discordapp.com/emojis/$2.webp?size=20" alt=":$1:" title=":$1:">'
  );

  // 8. Newlines → <br>
  html = html.replace(/\n/g, "<br>");

  return html;
}

function colorToHex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isEmbedEmpty(embed: EmbedData): boolean {
  return !embed.title && !embed.description && !embed.url && !embed.author;
}

function EmbedCard(props: { embed: EmbedData }) {
  const embed = props.embed;
  const colorBar = embed.color != null ? colorToHex(embed.color) : "var(--border)";

  return (
    <div class="chat-embed">
      <div class="chat-embed__color-bar" style={{ background: colorBar }} />
      <div class="chat-embed__body">
        <Show when={embed.author}>
          {(author) => (
            <div class="chat-embed__author">
              <Show when={author().icon_url}>
                {(icon) => <img class="chat-embed__author-icon" src={icon()} alt="" />}
              </Show>
              <Show when={author().url} fallback={<span>{author().name}</span>}>
                {(url) => (
                  <a href={url()} target="_blank" rel="noopener noreferrer">
                    {author().name}
                  </a>
                )}
              </Show>
            </div>
          )}
        </Show>
        <div class="chat-embed__inner">
          <div class="chat-embed__content">
            <Show when={embed.title}>
              {(title) => (
                <div class="chat-embed__title">
                  <Show when={embed.url} fallback={<span>{title()}</span>}>
                    {(url) => (
                      <a href={url()} target="_blank" rel="noopener noreferrer">
                        {title()}
                      </a>
                    )}
                  </Show>
                </div>
              )}
            </Show>
            <Show when={embed.description}>
              {(desc) => (
                <div
                  class="chat-embed__description"
                  innerHTML={renderMarkdown(desc())}
                />
              )}
            </Show>
            <Show when={embed.fields && embed.fields.length > 0}>
              <div class="chat-embed__fields">
                <For each={embed.fields}>
                  {(field) => (
                    <div
                      class={`chat-embed__field${field.inline === false ? " chat-embed__field--full" : ""}`}
                    >
                      <div class="chat-embed__field-name">{field.name}</div>
                      <div
                        class="chat-embed__field-value"
                        innerHTML={renderMarkdown(field.value)}
                      />
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
          <Show when={embed.thumbnail?.url}>
            {(thumbUrl) => (
              <img
                class="chat-embed__thumbnail"
                src={thumbUrl()}
                alt="thumbnail"
                loading="lazy"
              />
            )}
          </Show>
        </div>
        <Show when={embed.image?.url}>
          {(imgUrl) => (
            <img
              src={imgUrl()}
              alt="embed image"
              loading="lazy"
              style={{ "max-width": "100%", "border-radius": "4px", "margin-top": "4px" }}
            />
          )}
        </Show>
        <Show when={embed.footer}>
          {(footer) => (
            <div class="chat-embed__footer">{footer().text}</div>
          )}
        </Show>
      </div>
    </div>
  );
}

function AttachmentView(props: { attachment: AttachmentData }) {
  const att = props.attachment;

  if (att.url === "" && att.filename === "unknown") return null;

  const isImage = att.content_type?.startsWith("image/") ?? false;
  const isVideo = att.content_type?.startsWith("video/") ?? false;

  if (isImage && att.url) {
    return (
      <div class="chat-attachment">
        <img
          class="chat-attachment__image"
          src={att.url}
          alt={att.filename}
          loading="lazy"
        />
      </div>
    );
  }

  if (isVideo && att.url) {
    return (
      <div class="chat-attachment">
        <video class="chat-attachment__video" controls>
          <source src={att.url} type={att.content_type} />
        </video>
      </div>
    );
  }

  return (
    <div class="chat-attachment">
      <div class="chat-attachment__file">
        <span>📎</span>
        <Show
          when={att.url}
          fallback={<span>{att.filename}</span>}
        >
          {(url) => (
            <a href={url()} target="_blank" rel="noopener noreferrer" download>
              {att.filename}
            </a>
          )}
        </Show>
        <Show when={att.size != null}>
          <span class="dim">{formatFileSize(att.size!)}</span>
        </Show>
      </div>
    </div>
  );
}

function StickerView(props: { sticker: StickerData }) {
  const { id, name, format_type } = props.sticker;

  if (format_type === 3) {
    return <span class="dim small">[sticker: {name}]</span>;
  }

  const ext = format_type === 4 ? "gif" : "png";
  const src = `https://media.discordapp.net/stickers/${id}.${ext}?size=160`;

  return <img class="chat-sticker" src={src} alt={name} title={name} loading="lazy" />;
}

function ComponentView(props: { component: DiscordComponentData }) {
  const comp = props.component;

  if (comp.type === 17) {
    const accentColor = comp.accentColor ?? comp.accent_color;
    const borderColor = accentColor != null ? colorToHex(accentColor) : "var(--border)";
    return (
      <div
        class="chat-component chat-component--container"
        style={{ "border-left-color": borderColor }}
      >
        <Show when={comp.components}>
          <For each={comp.components}>
            {(child) => <ComponentView component={child} />}
          </For>
        </Show>
      </div>
    );
  }

  if (comp.type === 10) {
    return (
      <div
        class="chat-component__text"
        innerHTML={renderMarkdown(comp.content ?? "")}
      />
    );
  }

  if (comp.type === 9) {
    return (
      <>
        <Show when={comp.components}>
          <For each={comp.components}>
            {(child) => <ComponentView component={child} />}
          </For>
        </Show>
      </>
    );
  }

  return null;
}

export default function ChatMessage(props: Props) {
  const content = () => (props.isStreaming ? props.streamContent ?? "" : props.message.content);
  const isUser = () => props.message.author_id === "web-user";

  const data = (): MessageData | null => {
    const raw = props.message.data;
    if (!raw) return null;
    try { return JSON.parse(raw) as MessageData; }
    catch { return null; }
  };

  const visibleAttachments = () =>
    (data()?.attachments ?? []).filter(
      (a) => !(a.url === "" && a.filename === "unknown")
    );

  const visibleEmbeds = () =>
    (data()?.embeds ?? []).filter((e) => !isEmbedEmpty(e));

  return (
    <div class={`chat-message${isUser() ? " chat-message--user" : " chat-message--bot"}`}>
      <div class="chat-message__header row">
        <span class="chat-message__author small">{props.message.author_name}</span>
        <Show when={props.isStreaming}>
          <span class="chat-message__streaming dim small">…</span>
        </Show>
      </div>
      <div class="chat-message__body">{content()}</div>
      <Show when={data()}>
        <div class="chat-message__extras">
          <For each={visibleAttachments()}>
            {(att) => <AttachmentView attachment={att} />}
          </For>
          <For each={data()?.stickers ?? []}>
            {(sticker) => <StickerView sticker={sticker} />}
          </For>
          <For each={visibleEmbeds()}>
            {(embed) => <EmbedCard embed={embed} />}
          </For>
          <For each={data()?.components ?? []}>
            {(comp) => <ComponentView component={comp} />}
          </For>
        </div>
      </Show>
    </div>
  );
}
