import { describe, test, expect } from "bun:test";
import type { CreateRequestBodyOptions, RequestBody, RequestMethods, RestManager } from "@discordeno/bot";
import { installRestTimeout, type TimedRequestBody } from "./rest-timeout";

/**
 * Minimal stand-in for Discordeno's rest manager: `createRequestBody` mirrors
 * the real implementation's return shape ({ headers, body?, method }).
 */
function makeFakeRest(): Pick<RestManager, "createRequestBody"> {
  return {
    createRequestBody(method: RequestMethods, options?: CreateRequestBodyOptions): RequestBody {
      let body: string | FormData | undefined;
      if (options?.files !== undefined) {
        body = new FormData();
      } else if (options?.body !== undefined) {
        body = JSON.stringify(options.body);
      }
      return { headers: {}, method, body };
    },
  };
}

describe("installRestTimeout", () => {
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
    // Simulates Discordeno's failure mode: the server accepts the connection
    // but never responds (black-holed request). Without a signal this fetch
    // pends forever and, because the route queue awaits each request in
    // series, wedges every later request. With the patch it must reject
    // within the timeout so the next request in the loop proceeds.
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
