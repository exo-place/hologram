/**
 * SSE client for streaming channel events.
 *
 * Usage:
 *   const sub = subscribeSSE("web:xxx", (event) => console.log(event));
 *   sub.close(); // when done
 */

export interface SSESubscription {
  close: () => void;
}

export function subscribeSSE(
  channelId: string,
  onEvent: (event: Record<string, unknown>) => void,
  onError?: (err: Event) => void,
  streamUrl?: string,
): SSESubscription {
  const url = streamUrl ?? `/api/channels/${channelId}/stream`;
  const es = new EventSource(url);

  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data) as Record<string, unknown>;
      onEvent(data);
    } catch {
      // Ignore malformed events
    }
  };

  if (onError) es.onerror = onError;

  return { close: () => es.close() };
}
