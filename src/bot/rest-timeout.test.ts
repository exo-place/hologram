import { describe, test, expect } from "bun:test";
import type { CreateRequestBodyOptions, MakeRequestOptions, Queue, RequestBody, RequestMethods, RestManager } from "@discordeno/bot";
import { installRestTimeout, type TimedRequestBody } from "./rest-timeout";

type RestLike = Pick<RestManager, "createRequestBody" | "makeRequest" | "simplifyUrl" | "queues" | "token">;

/**
 * Minimal stand-in for Discordeno's rest manager: `createRequestBody` mirrors
 * the real implementation's return shape ({ headers, body?, method });
 * `makeRequest` behavior is injectable per test.
 */
function makeFakeRest(
  makeRequestImpl?: (method: RequestMethods, url: string, options?: MakeRequestOptions) => Promise<unknown>,
): RestLike {
  return {
    token: "testtoken",
    queues: new Map<string, Queue>(),
    simplifyUrl(url: string, _method: RequestMethods): string {
      return url;
    },
    createRequestBody(method: RequestMethods, options?: CreateRequestBodyOptions): RequestBody {
      let body: string | FormData | undefined;
      if (options?.files !== undefined) {
        body = new FormData();
      } else if (options?.body !== undefined) {
        body = JSON.stringify(options.body);
      }
      return { headers: {}, method, body };
    },
    makeRequest<T = unknown>(method: RequestMethods, url: string, options?: MakeRequestOptions): Promise<T> {
      return (makeRequestImpl?.(method, url, options) ?? Promise.resolve(undefined)) as Promise<T>;
    },
  };
}

describe("installRestTimeout — layer 1 (fetch abort signal)", () => {
  test("attaches an AbortSignal that fires after timeoutMs", async () => {
    const rest = makeFakeRest();
    installRestTimeout(rest, { timeoutMs: 50 });

    const payload: TimedRequestBody = rest.createRequestBody("GET");
    expect(payload.signal).toBeInstanceOf(AbortSignal);
    expect(payload.signal?.aborted).toBe(false);
    // Original payload shape is preserved
    expect(payload.method).toBe("GET");
    expect(payload.headers).toEqual({});

    await Bun.sleep(80);
    expect(payload.signal?.aborted).toBe(true);
  });

  test("each request gets its own fresh signal", async () => {
    const rest = makeFakeRest();
    installRestTimeout(rest, { timeoutMs: 60 });

    const first: TimedRequestBody = rest.createRequestBody("GET");
    await Bun.sleep(40);
    const second: TimedRequestBody = rest.createRequestBody("GET");
    expect(second.signal).not.toBe(first.signal);

    await Bun.sleep(30);
    // First (70ms old) has expired; second (30ms old) has not.
    expect(first.signal?.aborted).toBe(true);
    expect(second.signal?.aborted).toBe(false);
  });

  test("file uploads get the more generous upload timeout", async () => {
    const rest = makeFakeRest();
    installRestTimeout(rest, { timeoutMs: 40, uploadTimeoutMs: 200 });

    const upload: TimedRequestBody = rest.createRequestBody("POST", {
      files: [{ blob: new Blob(["x"]), name: "a.png" }],
    });
    const plain: TimedRequestBody = rest.createRequestBody("POST", { body: { a: 1 } });

    await Bun.sleep(80);
    expect(plain.signal?.aborted).toBe(true);
    expect(upload.signal?.aborted).toBe(false);

    await Bun.sleep(160);
    expect(upload.signal?.aborted).toBe(true);
  });

  test("a hung fetch rejects within the timeout and a serial queue drains past it", async () => {
    // Simulates failure mode 1: the server accepts the connection but never
    // responds. Without a signal this fetch pends forever and, because the
    // route queue awaits each request in series, wedges every later request.
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/hang") return new Promise<Response>(() => {});
        return new Response("ok");
      },
    });

    try {
      const rest = makeFakeRest();
      installRestTimeout(rest, { timeoutMs: 100 });

      const results: string[] = [];
      const started = Date.now();
      // Serial loop, mirroring queue.js processPending(): one request at a time.
      for (const path of ["/hang", "/ok"]) {
        const payload = rest.createRequestBody("GET");
        const request = new Request(`http://localhost:${server.port}${path}`, payload);
        try {
          const res = await fetch(request);
          results.push(`ok:${await res.text()}`);
        } catch (err) {
          results.push(`err:${err instanceof Error ? err.name : String(err)}`);
        }
      }
      const elapsed = Date.now() - started;

      // The hung request rejected (instead of pending forever)...
      expect(results[0]).toStartWith("err:");
      // ...quickly enough that it cannot wedge the queue...
      expect(elapsed).toBeLessThan(2000);
      // ...and the next request in the serial queue completed normally.
      expect(results[1]).toBe("ok:ok");
    } finally {
      server.stop(true);
    }
  });
});

describe("installRestTimeout — layer 2 (outer makeRequest bound)", () => {
  test("a makeRequest that never settles rejects within the outer timeout", async () => {
    // Simulates failure mode 2: the queue loop is stalled, so the request
    // promise never settles and no fetch (hence no abort signal) ever exists.
    const rest = makeFakeRest(() => new Promise(() => {}));
    installRestTimeout(rest, { outerTimeoutMs: 50 });

    const started = Date.now();
    await expect(rest.makeRequest("GET", "/channels/123")).rejects.toThrow(
      /outer timeout after 50ms: GET \/channels\/123/,
    );
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("a makeRequest that settles under the bound passes its value through untouched", async () => {
    const rest = makeFakeRest(async () => {
      await Bun.sleep(20);
      return { id: "42" };
    });
    installRestTimeout(rest, { outerTimeoutMs: 200 });

    const result = await rest.makeRequest<{ id: string }>("GET", "/channels/42");
    expect(result).toEqual({ id: "42" });
  });

  test("an inner rejection under the bound propagates unchanged (fail-open path)", async () => {
    const boom = new Error("[999] Unknown error");
    const rest = makeFakeRest(() => Promise.reject(boom));
    installRestTimeout(rest, { outerTimeoutMs: 200 });

    await expect(rest.makeRequest("GET", "/guilds/1/members/2")).rejects.toBe(boom);
  });

  test("outer timeout drops the stalled route queue so the next request gets a fresh one", async () => {
    const rest = makeFakeRest(() => new Promise(() => {}));
    installRestTimeout(rest, { outerTimeoutMs: 40 });

    // Pre-populate the queue map the way manager.js processRequest keys it.
    const stalledKey = `Bot ${rest.token}${rest.simplifyUrl("/guilds/1/members/2", "GET")}`;
    const otherKey = `Bot ${rest.token}/channels/999`;
    rest.queues.set(stalledKey, {} as Queue);
    rest.queues.set(otherKey, {} as Queue);

    await expect(rest.makeRequest("GET", "/guilds/1/members/2")).rejects.toThrow(/outer timeout/);

    // The stalled route's queue entry was removed; unrelated queues untouched.
    expect(rest.queues.has(stalledKey)).toBe(false);
    expect(rest.queues.has(otherKey)).toBe(true);
  });
});
