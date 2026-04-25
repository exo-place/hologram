import { describe, expect, test, beforeEach } from "bun:test";
import { runOnChannel, _resetQueueForTests } from "./channel-queue";

beforeEach(() => {
  _resetQueueForTests();
});

describe("runOnChannel", () => {
  test("same-channel tasks are serialized even when enqueued in the same tick", async () => {
    const order: number[] = [];

    // Enqueue both in the same tick — task 2 must run after task 1 completes
    const p1 = runOnChannel("ch1", async () => {
      await new Promise<void>(r => setTimeout(r, 20));
      order.push(1);
    });
    const p2 = runOnChannel("ch1", async () => {
      order.push(2);
    });

    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  test("different-channel tasks run concurrently", async () => {
    const starts: string[] = [];

    // Both tasks start before either completes
    const p1 = runOnChannel("ch-a", async () => {
      starts.push("a");
      await new Promise<void>(r => setTimeout(r, 20));
    });
    const p2 = runOnChannel("ch-b", async () => {
      starts.push("b");
      await new Promise<void>(r => setTimeout(r, 20));
    });

    // Give both tasks a chance to start before waiting
    await new Promise<void>(r => setTimeout(r, 5));
    expect(starts).toContain("a");
    expect(starts).toContain("b");

    await Promise.all([p1, p2]);
  });

  test("throwing task does not poison subsequent tasks", async () => {
    const results: string[] = [];

    const p1 = runOnChannel("ch2", async () => {
      throw new Error("boom");
    }).catch(() => { /* expected */ });

    const p2 = runOnChannel("ch2", async () => {
      results.push("ran");
    });

    await Promise.all([p1, p2]);
    expect(results).toEqual(["ran"]);
  });

  test("timeout fires and releases slot so subsequent tasks run", async () => {
    const results: string[] = [];

    const p1 = runOnChannel("ch3", async () => {
      // Task that takes longer than the timeout
      await new Promise<void>(r => setTimeout(r, 200));
      results.push("slow");
    }, { timeoutMs: 30, label: "slow-task" }).catch(() => { /* timeout */ });

    const p2 = runOnChannel("ch3", async () => {
      results.push("fast");
    }, { timeoutMs: 500 });

    await Promise.all([p1, p2]);
    // The slow task was cut off, but the fast task ran
    expect(results).toContain("fast");
    // The slow task's body may or may not have continued after the race
    expect(results).not.toContain("slow");
  });

  test("returns the task result", async () => {
    const result = await runOnChannel("ch4", async () => 42);
    expect(result).toBe(42);
  });
});
