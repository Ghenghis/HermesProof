/**
 * Promise-chain mutex — serializes async mutators against shared state.
 *
 * HermesProof's MCP server is a single Node.js process, so JavaScript itself
 * is single-threaded — but `async` mutators that interleave `await` points
 * during a read-modify-write sequence are NOT atomic. Two concurrent MCP
 * tool calls can both read the same state, mutate locally, and race on the
 * write, dropping one update.
 *
 * `a2a-stub.mjs` solved this with an inline `_serialize` Promise chain.
 * The 2026-05-03 audit (cross-confirmed by Claude × 5 + Codex × 5) showed
 * the same pattern was missing across reputation, skill-rotation,
 * anonymous-orchestrator, lock-manager `heartbeat`, queue-manager `heartbeat`,
 * and event-manager `markEventHandled`. This helper extracts the pattern
 * into a single shared primitive.
 *
 * Each consumer creates its own mutex via `makeMutex()`, stashes the closure
 * on `this`, and wraps each mutator:
 *
 *     constructor() {
 *       this._mutex = makeMutex();
 *     }
 *
 *     async recordOutcome(actor_id, outcome) {
 *       if (!actor_id) throw new Error("actor_id required");
 *       return this._mutex(async () => {
 *         const state = await this._read();
 *         // ... mutate state ...
 *         await this._write(state);
 *         return result;
 *       });
 *     }
 *
 * Failure isolation: a rejection in one mutator does NOT poison the chain
 * for subsequent calls. The original promise still rejects, so the caller
 * sees the error, but the queue tail uses `.catch(() => {})` so the next
 * mutator runs on a fresh resolved promise.
 *
 * Single-process scope: this is in-memory, per-instance. It serializes
 * mutators within ONE Node process. It does NOT protect against multiple
 * processes writing the same state file — that requires file-system-level
 * locking (a separate, much harder problem). HermesProof's design assumes
 * one MCP server process per workspace, so per-instance serialization is
 * the correct boundary.
 */

/**
 * Create a fresh mutex. Returns a function that serializes async work.
 *
 * @returns {(fn: () => Promise<T>) => Promise<T>}
 */
export function makeMutex() {
  let queue = Promise.resolve();
  return function mutex(fn) {
    const next = queue.then(() => fn());
    // Tail uses .catch so a rejection in one mutator doesn't block the next.
    // Caller still sees the rejection via the returned `next` promise.
    queue = next.catch(() => {});
    return next;
  };
}
