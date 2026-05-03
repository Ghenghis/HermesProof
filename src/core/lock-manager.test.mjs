import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HermesLockManager } from "./lock-manager.mjs";

async function withManager(fn) {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hp-lock-manager-"));
  const manager = new HermesLockManager({ workspaceRoot });
  await manager.init();
  try {
    await fn(manager);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
}

test("legacy task and handoff path component IDs reject traversal characters", async () => {
  const invalidIds = ["/etc/passwd", "../escape", "id\0null", "id with space"];

  await withManager(async (manager) => {
    for (const badId of invalidIds) {
      await assert.rejects(
        manager.claimTask({ owner: "codex-test", taskId: badId }),
        /must use only|parent refs/,
        `claimTask should reject ${JSON.stringify(badId)}`
      );
      await assert.rejects(
        manager.releaseTask({ owner: "codex-test", taskId: badId }),
        /must use only|parent refs/,
        `releaseTask should reject ${JSON.stringify(badId)}`
      );
      await assert.rejects(
        manager.approveHandoff({ owner: "codex-test", requestId: badId }),
        /must use only|parent refs/,
        `approveHandoff should reject ${JSON.stringify(badId)}`
      );
      await assert.rejects(
        manager.createBlockedHandoff({
          owner: "codex-test",
          task_id: badId,
          reason: "blocked",
          handoff_path: "handoffs/blocked.md"
        }),
        /must use only|parent refs/,
        `createBlockedHandoff should reject ${JSON.stringify(badId)}`
      );
    }
  });
});
