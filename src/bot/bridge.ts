/**
 * Bot bridge — thin mutable reference that lets the API layer call into the bot
 * without creating a circular import. The bot sets these when it starts; the API
 * layer checks `isBotConnected()` and calls `sendToDiscordChannel()`.
 */

type SendFn = (channelId: string, content: string, authorName?: string) => Promise<void>;

let _send: SendFn | null = null;

export function setBotBridge(sendFn: SendFn): void {
  _send = sendFn;
}

export function isBotConnected(): boolean {
  return _send !== null;
}

export async function sendToDiscordChannel(channelId: string, content: string, authorName?: string): Promise<void> {
  if (!_send) throw new Error("Bot not connected");
  return _send(channelId, content, authorName);
}
