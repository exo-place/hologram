/**
 * REST timeouts for Discordeno — two layers.
 *
 * Discordeno's rest manager sends every request through a serial per-route
 * queue (`@discordeno/rest` queue.js). Two distinct failure modes can stall it
 * forever, and both manifested in production as the wedged-channel incident
 * (mention/random replies dead at the 120s channel-queue timeout while
 * /trigger, which avoids those routes, kept working):
 *
 * 1. **Hung fetch** — `sendRequest` calls `fetch` with no timeout/AbortSignal
 *    (manager.js), so a black-holed TCP connection pends forever and blocks
 *    the serial queue behind it.
 * 2. **Stalled queue loop** — after a socket-level failure (`FailedToOpenSocket`)
 *    no response headers are processed, the queue's rate-limit bookkeeping
 *    (`remaining` / `interval` / `frozenAt`) is left inconsistent, and
 *    `processPending` can spin in its delay loop without ever issuing another
 *    fetch. Observed live 2026-07-06→08: ~50 task timeouts with ZERO
 *    fetch-level aborts firing — the hang was upstream of `fetch`.
 *
 * Layer 1 (`createRequestBody` patch): every request payload carries an
 * `AbortSignal.timeout(...)`. `sendRequest` builds `new Request(url, payload)`
 * from that payload and `fetch(request)` honours the request's signal — a hung
 * connection rejects within the timeout, the rejection flows through the
 * existing catch in `sendRequest` (rejects the caller with status 999), and
 * the queue drains past the dead request.
 *
 * Layer 2 (`makeRequest` patch): an outer promise timeout on the whole
 * request lifecycle (queue wait + fetch + retries). This fires even when the
 * queue loop is stalled and no fetch — hence no signal — was ever created.
 * On expiry it also drops the route's queue entry from `rest.queues` so
 * subsequent requests get a fresh, unstalled queue (the frozen Queue object
 * is detached; its dangling pending requests are each bounded by their own
 * outer timeout). The rejection is a plain Error, so existing fail-open
 * handling (deputy check, channel/guild metadata) applies unchanged.
 *
 * Both layers hook the manager's own public surface — no node_modules edits.
 */

import type { MakeRequestOptions, RequestBody, RequestMethods, RestManager } from "@discordeno/bot";
import { debug, warn } from "../logger";

/** Fetch-level timeout for Discord REST calls. */
export const REST_TIMEOUT_MS = 30_000;

/** More generous fetch-level timeout for requests uploading files (webhook attachments etc.). */
export const REST_UPLOAD_TIMEOUT_MS = 60_000;

/**
 * Outer bound on the whole request lifecycle (queue wait + fetch + retries).
 * Reasoning: normal route rate-limit waits are sub-second to a few seconds;
 * the fetch itself is bounded at 30s (60s for uploads); a 429 retry re-queues
 * once more. 90s comfortably exceeds upload + retry headroom while staying
 * 30s under the 120s channel-queue timeout, so the rejection surfaces into
 * fail-open handlers *before* the message task is killed.
 */
export const REST_OUTER_TIMEOUT_MS = 90_000;

/** Request payload after patching: carries the abort signal `fetch` will honour. */
export type TimedRequestBody = RequestBody & { signal?: AbortSignal };

type RestLike = Pick<RestManager, "createRequestBody" | "makeRequest" | "simplifyUrl" | "queues" | "token">;

/**
 * Drop a (presumed stalled) route queue so the next request creates a fresh
 * one. Key format mirrors manager.js `processRequest`:
 * `${authorization}${simplifyUrl(route, method)}` with authorization
 * defaulting to `Bot ${token}`. Returns whether an entry was removed; a
 * changed key format upstream degrades to a harmless no-op.
 */
function dropRouteQueue(rest: RestLike, method: RequestMethods, route: string): boolean {
  try {
    const key = `Bot ${rest.token}${rest.simplifyUrl(route, method)}`;
    return rest.queues.delete(key);
  } catch {
    return false;
  }
}

/**
 * Install both timeout layers on `bot.rest`. Call once after `createBot`.
 */
export function installRestTimeout(
  rest: RestLike,
  opts?: { timeoutMs?: number; uploadTimeoutMs?: number; outerTimeoutMs?: number },
): void {
  const timeoutMs = opts?.timeoutMs ?? REST_TIMEOUT_MS;
  const uploadTimeoutMs = opts?.uploadTimeoutMs ?? REST_UPLOAD_TIMEOUT_MS;
  const outerTimeoutMs = opts?.outerTimeoutMs ?? REST_OUTER_TIMEOUT_MS;

  // Layer 1: abort signal on the actual fetch.
  const originalCreateRequestBody = rest.createRequestBody.bind(rest);
  rest.createRequestBody = (method, options) => {
    const payload = originalCreateRequestBody(method, options);
    // File uploads (FormData bodies) can legitimately take longer than plain
    // JSON calls — give them more headroom, still bounded.
    const isUpload = options?.files !== undefined || payload.body instanceof FormData;
    const ms = isUpload ? uploadTimeoutMs : timeoutMs;
    return Object.assign(payload, { signal: AbortSignal.timeout(ms) });
  };

  // Layer 2: outer bound on the whole request lifecycle.
  const originalMakeRequest = rest.makeRequest;
  rest.makeRequest = <T = unknown>(
    method: RequestMethods,
    url: string,
    options?: MakeRequestOptions,
  ): Promise<T> => {
    const inner = originalMakeRequest.call(rest, method, url, options) as Promise<T>;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const healed = dropRouteQueue(rest, method, url);
        warn("Discord REST request exceeded outer timeout — route queue likely stalled", {
          method,
          route: url,
          outerTimeoutMs,
          queueDropped: healed,
        });
        reject(new Error(`Discord REST outer timeout after ${outerTimeoutMs}ms: ${method} ${url}`));
      }, outerTimeoutMs);
      timer.unref?.();
      // Handlers are attached immediately, so a late settle after the timeout
      // fired is a no-op (never an unhandled rejection).
      inner.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err: unknown) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  };

  debug("Installed Discord REST timeouts", { timeoutMs, uploadTimeoutMs, outerTimeoutMs });
}
