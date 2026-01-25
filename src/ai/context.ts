/**
 * Context types and utilities
 *
 * Core types for message handling. Context assembly is now handled by
 * the plugin system (src/plugins/).
 */

import type { TimeState } from "../scene";

/** Message in the conversation history */
export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  name?: string;
  timestamp?: number; // Real-world timestamp (Date.now())
  gameTime?: TimeState; // In-world game time when message was recorded
}

/** Format messages for AI SDK (filters system messages, adds names) */
export function formatMessagesForAI(
  messages: Message[]
): Array<{ role: "user" | "assistant"; content: string }> {
  const result: Array<{ role: "user" | "assistant"; content: string }> = [];
  let pendingTimestamp: string | null = null;

  for (const m of messages) {
    if (m.role === "system") {
      // Buffer timestamp markers to prepend to the next message
      pendingTimestamp = m.content;
      continue;
    }

    if (m.role !== "user" && m.role !== "assistant") continue;

    let content = m.name ? `${m.name}: ${m.content}` : m.content;

    // Prepend buffered timestamp to this message
    if (pendingTimestamp) {
      content = `${pendingTimestamp}\n${content}`;
      pendingTimestamp = null;
    }

    result.push({
      role: m.role as "user" | "assistant",
      content,
    });
  }

  return result;
}
