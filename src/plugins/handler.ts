/**
 * Plugin-based Message Handler
 *
 * Replaces the monolithic message.ts with a middleware-based approach.
 * This is the main entry point for processing messages.
 */

import { createContext, runMiddleware } from "./registry";
import { getDeliveryResult, type DeliveryResult } from "./delivery";

/** Result from message handling */
export type MessageResult = DeliveryResult;

/** In-memory message history accessor (for external access) */
import { enableChannel, disableChannel, isChannelEnabled, clearHistory } from "./core";
export { enableChannel, disableChannel, isChannelEnabled, clearHistory };

/** Legacy character management (for sceneless operation) */
import { setActiveCharacter, getActiveCharacterLegacy } from "./scene";
export { setActiveCharacter, getActiveCharacterLegacy as getActiveCharacter };

/**
 * Handle an incoming message through the plugin middleware chain.
 *
 * This is the main entry point for the plugin system. It:
 * 1. Creates a context from the message
 * 2. Runs the middleware chain
 * 3. Returns the result (or null if no response)
 */
export async function handleMessage(
  channelId: string,
  guildId: string | undefined,
  authorId: string,
  authorName: string,
  content: string,
  isBotMentioned: boolean
): Promise<MessageResult | null> {
  // Create initial context
  const ctx = createContext({
    channelId,
    guildId,
    authorId,
    authorName,
    content,
    isBotMentioned,
  });

  try {
    // Run the middleware chain
    await runMiddleware(ctx);

    // Get delivery result
    const result = getDeliveryResult(ctx);

    if (!result?.response) {
      return null;
    }

    return result;
  } catch (error) {
    console.error("Error in message handler:", error);
    return null;
  }
}
