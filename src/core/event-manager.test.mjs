import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventManager } from "./event-manager.mjs";

function eventId(index) {
  return `evt_20261025T${String(index).padStart(6, "0")}Z_abcdef`;
}

test("listEvents returns events after a cursor beyond the oldest 500", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-events-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manager = new EventManager({ workspaceRoot: root });
  await manager.init();

  for (let index = 0; index < 650; index += 1) {
    const id = eventId(index);
    await fs.writeFile(
      path.join(manager.paths.eventsOutboxDir, `${id}.json`),
      JSON.stringify({ event_id: id, event_type: "message.sent" }),
      "utf8"
    );
  }

  const result = await manager.listEvents({
    status: "outbox",
    limit: 25,
    afterEventId: eventId(600)
  });
  assert.equal(result.count, 650);
  assert.equal(result.matched_count, 49);
  assert.equal(result.events.length, 25);
  assert.equal(result.events[0].event_id, eventId(601));
  assert.equal(result.events.at(-1).event_id, eventId(625));
});

test("listEvents preserves the existing oldest-first page without a cursor", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-events-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manager = new EventManager({ workspaceRoot: root });
  await manager.init();
  for (let index = 0; index < 3; index += 1) {
    const id = eventId(index);
    await fs.writeFile(
      path.join(manager.paths.eventsOutboxDir, `${id}.json`),
      JSON.stringify({ event_id: id, event_type: "message.sent" }),
      "utf8"
    );
  }
  const result = await manager.listEvents({ status: "outbox", limit: 2 });
  assert.deepEqual(result.events.map((event) => event.event_id), [eventId(0), eventId(1)]);
});

test("concurrent emits receive strictly increasing cursor timestamps", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-events-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manager = new EventManager({ workspaceRoot: root });
  const emitted = await Promise.all(Array.from({ length: 32 }, (_, index) =>
    manager.emitEvent({ event_type: "message.sent", summary: `event ${index}` })
  ));
  const ids = emitted.map((item) => item.event.event_id);
  assert.deepEqual(ids, [...ids].sort());
  assert.equal(new Set(emitted.map((item) => item.event.created_utc)).size, 32);
  const after = await manager.listEvents({ afterEventId: ids[15], limit: 50 });
  assert.deepEqual(after.events.map((event) => event.event_id), ids.slice(16));
});
