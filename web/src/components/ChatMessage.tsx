import { Show } from "solid-js";
import type { ApiMessage } from "../api/client";
import "./ChatMessage.css";

interface Props {
  message: ApiMessage;
  isStreaming?: boolean;
  streamContent?: string;
}

export default function ChatMessage(props: Props) {
  const content = () => (props.isStreaming ? props.streamContent ?? "" : props.message.content);
  const isUser = () => props.message.author_id === "web-user";

  return (
    <div class={`chat-message${isUser() ? " chat-message--user" : " chat-message--bot"}`}>
      <div class="chat-message__header row">
        <span class="chat-message__author small">{props.message.author_name}</span>
        <Show when={props.isStreaming}>
          <span class="chat-message__streaming dim small">…</span>
        </Show>
      </div>
      <div class="chat-message__body">{content()}</div>
    </div>
  );
}
