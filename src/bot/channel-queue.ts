/**
 * Per-channel serialization queue.
 *
 * Ensures that message handlers for the same Discord/web channel run one
 * at a time so that each context build sees the prior entity's webhook reply
 * already stored in message history. Handlers for different channels run
 * concurrently.
 *
 * The tail of each channel's promise chain is stored in `tails`. The
 * `.set()` happens synchronously inside `runOnChannel` so that two callers
 * in the same tick both observe a non-resolved tail and correctly chain
 * behind it.
 *
 * A per-task hard timeout (default 120 s) breaks any slot that a wedged
 * LLM call would otherwise hold forever.
 */

import { warn, debug } from "../logger";

const tails = new Map<string, Promise<void>>();

const DEFAULT_TIMEOUT_MS = 120_000;

export function runOnChannel<T>(
  channelId: string,
  task: () => Promise<T>,
  opts?: { timeoutMs?: number; label?: string },
): Promise<T> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const label = opts?.label ?? "runOnChannel";

  let resolveSlot!: () => void;
  const slot = new Promise<void>(res => { resolveSlot = res; });

  const prev = tails.get(channelId) ?? Promise.resolve();
  // Store new tail synchronously — callers in the same tick chain behind this slot.
  tails.set(channelId, prev.then(() => slot));

  return prev.then(async (): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        warn("Channel queue task timed out", { channelId, label, timeoutMs });
        reject(new Error(`Channel queue timeout: ${label}`));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([task(), timeoutPromise]);
      return result;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      debug("Channel queue slot released", { channelId, label });
      resolveSlot();
      // Clean up the tail entry once the chain is idle to avoid unbounded growth.
      // We replace it with a no-op so in-flight chains that still hold a
      // reference to the old tail are unaffected.
      const currentTail = tails.get(channelId);
      if (currentTail) {
        currentTail.then(() => {
          if (tails.get(channelId) === currentTail) tails.delete(channelId);
        });
      }
    }
  });
}

/** Reset all queues — only for use in tests. */
export function _resetQueueForTests(): void {
  tails.clear();
}
