import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeMutex } from "./mutex.mjs";

describe("makeMutex", () => {
  it("returns a function", () => {
    const m = makeMutex();
    assert.equal(typeof m, "function");
  });

  it("each makeMutex() call returns an independent queue", async () => {
    const a = makeMutex();
    const b = makeMutex();
    const order = [];
    // a's queue blocks on a slow first task; b should run immediately.
    const slow = a(async () => {
      await new Promise((r) => setTimeout(r, 50));
      order.push("a-slow");
    });
    const fastOnB = b(async () => {
      order.push("b-fast");
    });
    await Promise.all([slow, fastOnB]);
    // b's task should land before a's slow task — proves they're not sharing a queue.
    assert.deepEqual(order, ["b-fast", "a-slow"]);
  });

  it("serializes async work — no two mutators ever overlap", async () => {
    const m = makeMutex();
    let inFlight = 0;
    let maxConcurrency = 0;
    const N = 50;
    const tasks = Array.from({ length: N }, (_, i) =>
      m(async () => {
        inFlight++;
        if (inFlight > maxConcurrency) maxConcurrency = inFlight;
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        return i;
      })
    );
    const results = await Promise.all(tasks);
    assert.equal(maxConcurrency, 1, "only one mutator should ever be in flight");
    assert.deepEqual(results, Array.from({ length: N }, (_, i) => i));
  });

  it("preserves FIFO order under heavy load", async () => {
    const m = makeMutex();
    const order = [];
    const tasks = Array.from({ length: 100 }, (_, i) =>
      m(async () => {
        order.push(i);
      })
    );
    await Promise.all(tasks);
    assert.deepEqual(order, Array.from({ length: 100 }, (_, i) => i));
  });

  it("a rejected mutator does NOT poison the chain (subsequent calls run)", async () => {
    const m = makeMutex();
    const failingCall = m(async () => {
      throw new Error("boom");
    });
    await assert.rejects(() => failingCall, /boom/);
    // Next call must still run successfully — chain not blocked.
    const result = await m(async () => "ok");
    assert.equal(result, "ok");
  });

  it("the original promise still rejects (caller sees the error)", async () => {
    const m = makeMutex();
    let caught = null;
    try {
      await m(async () => {
        throw new Error("expected");
      });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, "caller must see the rejection");
    assert.match(caught.message, /expected/);
  });

  it("returns the mutator's resolved value", async () => {
    const m = makeMutex();
    const r = await m(async () => ({ a: 1, b: [2, 3] }));
    assert.deepEqual(r, { a: 1, b: [2, 3] });
  });

  it("supports synchronous functions wrapped in async", async () => {
    const m = makeMutex();
    const r = await m(async () => 42);
    assert.equal(r, 42);
  });
});
