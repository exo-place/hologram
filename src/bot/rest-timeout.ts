/**
 * REST fetch timeout for Discordeno.
 *
 * Discordeno's rest manager sends every request through a serial per-route
 * queue and calls `fetch` with no timeout and no AbortSignal
 * (`@discordeno/rest` manager.js `sendRequest`). A single black-holed TCP
 * connection therefore pends forever, which permanently wedges that route's
 * queue: every later request to the same route waits behind it, with no error
 * ever logged. This caused the incident where all message-path REST calls
 * (canOwnerReadChannel, channel/guild metadata) hung until the 120s
 * channel-queue timeout killed each task — while /trigger, which avoids those
 * routes, kept working.
 *
 * Fix: patch `rest.createRequestBody` so every request payload carries an
 * `AbortSignal.timeout(...)`. `sendRequest` builds `new Request(url, payload)`
 * from that payload and `fetch(request)` honours the request's signal — so a
 * hung connection rejects within the timeout, the rejection flows through the
 * existing catch in `sendRequest` (which rejects the caller with status 999),
 * callers' fail-open handling applies unchanged, and the queue drains past
 * the dead request instead of wedging.
 *
 * This hooks the manager's own request-building step, so it covers ALL REST
 * calls (helpers, webhooks, the proxied path) without touching node_modules.
 */

import type { RestManager, RequestBody } from "@discordeno/bot";
import { debug } from "../logger";

/** Default timeout for Discord REST calls — well under the 120s channel-queue timeout. */
export const REST_TIMEOUT_MS = 30_000;

/** More generous timeout for requests uploading files (webhook attachments etc.). */
export const REST_UPLOAD_TIMEOUT_MS = 60_000;

/** Request payload after patching: carries the abort signal `fetch` will honour. */
export type TimedRequestBody = RequestBody & { signal?: AbortSignal };

type RestLike = Pick<RestManager, "createRequestBody">;

/**
 * Wrap `rest.createRequestBody` so every produced payload includes an
 * `AbortSignal.timeout(...)`. Call once on `bot.rest` after `createBot`.
 */
export function installRestTimeout(
  rest: RestLike,
  opts?: { timeoutMs?: number; uploadTimeoutMs?: number },
): void {
  const timeoutMs = opts?.timeoutMs ?? REST_TIMEOUT_MS;
  const uploadTimeoutMs = opts?.uploadTimeoutMs ?? REST_UPLOAD_TIMEOUT_MS;
  const original = rest.createRequestBody.bind(rest);
  rest.createRequestBody = (method, options) => {
    const payload = original(method, options);
    // File uploads (FormData bodies) can legitimately take longer than plain
    // JSON calls — give them more headroom, still bounded.
    const isUpload = options?.files !== undefined || payload.body instanceof FormData;
    const ms = isUpload ? uploadTimeoutMs : timeoutMs;
    return Object.assign(payload, { signal: AbortSignal.timeout(ms) });
  };
  debug("Installed Discord REST fetch timeout", { timeoutMs, uploadTimeoutMs });
}
