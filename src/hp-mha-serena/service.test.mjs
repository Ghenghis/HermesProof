import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { WorkspaceBindingError } from "../core/workspace-binding.mjs";
import {
  HpMhaSerenaError,
  HpMhaSerenaService
} from "./service.mjs";

function semanticAdapter() {
  return {
    async connect() {
      return { ok: true, semantic_tools: ["find_symbol"] };
    },
    health() {
      return { ok: true, semantic_tools: ["find_symbol"] };
    },
    async callSemantic(tool, argumentsValue) {
      return {
        ok: true,
        tool,
        result: JSON.stringify({ arguments: argumentsValue })
      };
    },
    async close() {}
  };
}

async function withWorkspace(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hp-mha-serena-"));
  await mkdir(path.join(root, "src"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("workspace-bound service claims, locks, reports, and releases atomically", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const service = new HpMhaSerenaService({
      workspaceRoot,
      stateDirName: ".hermes-test"
    });
    await service.init();
    const binding = await service.bindWorkspace({
      owner: "codex-test",
      ttlMs: 60_000
    });

    const claimed = await service.claimAndLock({
      workspaceHandle: binding.token,
      owner: "codex-test",
      role: "agent",
      taskId: "vertical-slice",
      title: "Complete one working slice",
      files: ["src/api.mjs", "src/ui.mjs"],
      reason: "Guard the vertical slice"
    });
    assert.equal(claimed.ok, true);
    assert.equal(claimed.status, "locked");
    assert.deepEqual(claimed.files, ["src/api.mjs", "src/ui.mjs"]);

    const status = await service.status({
      workspaceHandle: binding.token,
      owner: "codex-test"
    });
    assert.equal(status.ok, true);
    assert.equal(status.locks.length, 2);
    assert.equal(status.tasks[0].id, "vertical-slice");

    const released = await service.release({
      workspaceHandle: binding.token,
      owner: "codex-test",
      taskId: "vertical-slice",
      files: ["src/api.mjs", "src/ui.mjs"],
      note: "Verified"
    });
    assert.equal(released.ok, true);
    assert.equal(released.files.status, "released");
    assert.equal(released.task.status, "released");
  });
});

test("service rejects another principal and another workspace before coordination", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const service = new HpMhaSerenaService({
      workspaceRoot,
      stateDirName: ".hermes-test"
    });
    await service.init();
    const binding = await service.bindWorkspace({
      owner: "codex-test",
      ttlMs: 60_000
    });

    await assert.rejects(
      service.status({
        workspaceHandle: binding.token,
        owner: "other-agent"
      }),
      (error) => error instanceof WorkspaceBindingError && error.code === "PRINCIPAL_MISMATCH"
    );

    await withWorkspace(async (otherRoot) => {
      const other = new HpMhaSerenaService({
        workspaceRoot: otherRoot,
        stateDirName: ".hermes-test"
      });
      await other.init();
      await assert.rejects(
        other.status({
          workspaceHandle: binding.token,
          owner: "codex-test"
        }),
        (error) => error instanceof WorkspaceBindingError && error.code === "INVALID_SIGNATURE"
      );
    });

    const summary = await service.manager.getStateSummary();
    assert.equal(summary.locks.length, 0);
    assert.equal(summary.tasks.length, 0);
  });
});

test("persisted service identity accepts an unexpired handle after a clean restart", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const first = new HpMhaSerenaService({
      workspaceRoot,
      stateDirName: ".hermes-test"
    });
    await first.init();
    const binding = await first.bindWorkspace({
      owner: "codex-test",
      ttlMs: 60_000
    });

    const restarted = new HpMhaSerenaService({
      workspaceRoot,
      stateDirName: ".hermes-test"
    });
    await restarted.init();
    const status = await restarted.status({
      workspaceHandle: binding.token,
      owner: "codex-test"
    });

    assert.equal(status.ok, true);
    assert.equal(status.workspace_root, path.resolve(workspaceRoot));
  });
});

test("semantic inspection issues one-use source receipts for exact-lock edits", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const sourceFile = path.join(workspaceRoot, "src", "api.mjs");
    await writeFile(sourceFile, "export function api() { return \"old\"; }\n", "utf8");
    const service = new HpMhaSerenaService({
      workspaceRoot,
      stateDirName: ".hermes-test",
      serenaAdapterFactory: () => semanticAdapter()
    });
    await service.init();
    const binding = await service.bindWorkspace({
      owner: "codex-test",
      ttlMs: 60_000
    });
    await service.claimAndLock({
      workspaceHandle: binding.token,
      owner: "codex-test",
      taskId: "safe-edit",
      files: ["src/api.mjs"]
    });

    const inspected = await service.semanticInspect({
      workspaceHandle: binding.token,
      owner: "codex-test",
      tool: "find_symbol",
      arguments: {
        name_path_pattern: "api",
        relative_path: "src/api.mjs",
        include_body: true
      }
    });
    assert.equal(inspected.ok, true);
    assert.equal(inspected.receipt.file, "src/api.mjs");
    assert.equal(inspected.receipt.source_sha256.length, 64);

    const edited = await service.guardedReplace({
      workspaceHandle: binding.token,
      owner: "codex-test",
      taskId: "safe-edit",
      receiptId: inspected.receipt.id,
      file: "src/api.mjs",
      oldText: "\"old\"",
      newText: "\"new\""
    });
    assert.equal(edited.ok, true);
    assert.equal(edited.status, "edited");
    assert.match(await readFile(sourceFile, "utf8"), /"new"/u);
    assert.equal(edited.before_sha256, inspected.receipt.source_sha256);

    await assert.rejects(
      service.guardedReplace({
        workspaceHandle: binding.token,
        owner: "codex-test",
        taskId: "safe-edit",
        receiptId: inspected.receipt.id,
        file: "src/api.mjs",
        oldText: "\"new\"",
        newText: "\"again\""
      }),
      (error) =>
        error instanceof HpMhaSerenaError &&
        error.code === "SEMANTIC_RECEIPT_UNKNOWN"
    );
    await service.close();
  });
});

test("guarded edit rejects missing locks and post-analysis source drift", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const sourceFile = path.join(workspaceRoot, "src", "api.mjs");
    await writeFile(sourceFile, "export const value = \"old\";\n", "utf8");
    const service = new HpMhaSerenaService({
      workspaceRoot,
      stateDirName: ".hermes-test",
      serenaAdapterFactory: () => semanticAdapter()
    });
    await service.init();
    const binding = await service.bindWorkspace({
      owner: "codex-test",
      ttlMs: 60_000
    });
    const first = await service.semanticInspect({
      workspaceHandle: binding.token,
      owner: "codex-test",
      tool: "find_symbol",
      arguments: {
        name_path_pattern: "value",
        relative_path: "src/api.mjs"
      }
    });

    await assert.rejects(
      service.guardedReplace({
        workspaceHandle: binding.token,
        owner: "codex-test",
        taskId: "safe-edit",
        receiptId: first.receipt.id,
        file: "src/api.mjs",
        oldText: "\"old\"",
        newText: "\"new\""
      }),
      (error) =>
        error instanceof HpMhaSerenaError &&
        error.code === "EXACT_LOCK_REQUIRED"
    );

    await service.claimAndLock({
      workspaceHandle: binding.token,
      owner: "codex-test",
      taskId: "safe-edit",
      files: ["src/api.mjs"]
    });
    const second = await service.semanticInspect({
      workspaceHandle: binding.token,
      owner: "codex-test",
      tool: "find_symbol",
      arguments: {
        name_path_pattern: "value",
        relative_path: "src/api.mjs"
      }
    });
    await writeFile(sourceFile, "export const value = \"drifted\";\n", "utf8");

    await assert.rejects(
      service.guardedReplace({
        workspaceHandle: binding.token,
        owner: "codex-test",
        taskId: "safe-edit",
        receiptId: second.receipt.id,
        file: "src/api.mjs",
        oldText: "\"old\"",
        newText: "\"new\""
      }),
      (error) =>
        error instanceof HpMhaSerenaError &&
        error.code === "SOURCE_CHANGED_AFTER_ANALYSIS"
    );
    await service.close();
  });
});
