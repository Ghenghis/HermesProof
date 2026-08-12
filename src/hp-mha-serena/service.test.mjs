import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { WorkspaceBindingError } from "../core/workspace-binding.mjs";
import {
  HpMhaSerenaError,
  HpMhaSerenaService,
  UPDATE_OPERATION_FILE
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

test("service exposes workspace-bound lifecycle, capability, automation, and Kilo planning", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const kiloProbe = async (options) => ({
      schema: "hermesproof.kilo-backend-report.v1",
      ok: true,
      release_blockers: [],
      required_capabilities: [],
      components: { kilo_cli: { status: "REPLACED", release_blocking: false } },
      inventory: { bundled_kilo: { path: options.bundledKiloPath, present: true } }
    });
    const service = new HpMhaSerenaService({
      workspaceRoot,
      stateDirName: ".hermes-test",
      kiloProbe
    });
    await service.init();
    const binding = await service.bindWorkspace({ owner: "codex-test", ttlMs: 60_000 });
    const auth = { workspaceHandle: binding.token, owner: "codex-test" };

    const runtime = await service.runtimeStatus(auth);
    assert.deepEqual(runtime.runtimes, []);

    const resolved = await service.capabilityResolve({
      ...auth,
      requiredCapabilities: ["kilo.cli", "mcp.client"]
    });
    assert.deepEqual(resolved.selected_pack_ids, ["kilo-backend"]);
    const reverse = await service.capabilityResolve({
      ...auth,
      requiredCapabilities: ["reverse.static", "reverse.android"]
    });
    assert.deepEqual(reverse.selected_pack_ids, ["reverse-engineering-local"]);
    const packPlan = await service.capabilityPlan({ ...auth, packId: "kilo-backend" });
    assert.equal(packPlan.global_install, false);
    assert.equal(packPlan.enabled_after_install, false);

    const automation = await service.automationStatus(auth);
    assert.deepEqual(
      automation.jobs.map((job) => job.id),
      ["deep-doctor", "disable-unused-mcp", "completion-pulse"]
    );
    const schedule = await service.automationPlan({
      ...auth,
      jobId: "deep-doctor",
      platform: "windows"
    });
    assert.equal(schedule.adapter, "windows-task-scheduler");
    assert.equal(schedule.mutates_system, false);

    const doctor = await service.kiloBackendDoctor({
      ...auth,
      extensionVersion: "7.10.0-rc.25",
      bundledKiloPath: "G:/fixture/kilo.exe"
    });
    assert.equal(doctor.ok, true);
    assert.equal(doctor.inventory.bundled_kilo.path, "G:/fixture/kilo.exe");
    const kiloPlan = await service.kiloBackendPlan({
      ...auth,
      report: doctor
    });
    assert.deepEqual(kiloPlan.pack_ids, []);
    assert.equal(kiloPlan.global_install, false);
    await service.close();
  });
});

test("updater controls are workspace-bound, exact-lock guarded, and idempotent", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const calls = [];
    const updateManager = {
      status: async () => ({ ok: true, currentSha: "a".repeat(40) }),
      check: async () => ({ ok: true, candidateSha: "b".repeat(40), updateAvailable: true }),
      evidence: async ({ sha }) => ({ ok: true, sha }),
      apply: async () => {
        calls.push("apply");
        await new Promise((resolve) => setImmediate(resolve));
        return { ok: true, status: "activated", currentSha: "b".repeat(40) };
      },
      rollback: async () => ({ ok: true, status: "rolled_back" }),
      channel: async ({ channel }) => ({ ok: true, channel }),
      configureAuto: async ({ enabled }) => ({ ok: true, auto: { enabled } }),
      cleanup: async ({ retain, dryRun }) => ({ ok: true, retain, dryRun })
    };
    const service = new HpMhaSerenaService({
      workspaceRoot,
      stateDirName: ".hermes-test",
      updateManagerFactory: () => updateManager
    });
    await service.init();
    const binding = await service.bindWorkspace({ owner: "codex-test", ttlMs: 60_000 });
    const auth = { workspaceHandle: binding.token, owner: "codex-test" };
    assert.equal((await service.updateStatus(auth)).currentSha, "a".repeat(40));
    assert.equal((await service.updateCheck(auth)).updateAvailable, true);
    assert.equal((await service.updateEvidence({ ...auth, sha: "a".repeat(40) })).sha, "a".repeat(40));

    await service.manager.claimTask({
      owner: "codex-test",
      role: "agent",
      taskId: "update-e2e",
      files: [UPDATE_OPERATION_FILE],
      reason: "Prepare updater operation"
    });
    await assert.rejects(
      service.updateApply({ ...auth, taskId: "update-e2e", idempotencyKey: "apply-once" }),
      (error) => error instanceof HpMhaSerenaError && error.code === "EXACT_UPDATE_LOCK_REQUIRED"
    );
    await service.manager.lockFiles({
      owner: "codex-test",
      role: "agent",
      taskId: "update-e2e",
      files: [UPDATE_OPERATION_FILE],
      reason: "Guard updater activation"
    });
    const [first, second] = await Promise.all([
      service.updateApply({ ...auth, taskId: "update-e2e", idempotencyKey: "apply-once" }),
      service.updateApply({ ...auth, taskId: "update-e2e", idempotencyKey: "apply-once" })
    ]);
    assert.equal(first.currentSha, "b".repeat(40));
    assert.deepEqual(second, first);
    assert.deepEqual(calls, ["apply"]);
    assert.equal((await service.updateChannel({
      ...auth,
      taskId: "update-e2e",
      idempotencyKey: "preview-once",
      channel: "preview",
      acknowledgePreview: true
    })).channel, "preview");
    assert.equal((await service.updateAuto({
      ...auth,
      taskId: "update-e2e",
      idempotencyKey: "auto-once",
      enabled: true,
      cadenceHours: 6,
      jitterMinutes: 30
    })).auto.enabled, true);
    assert.equal((await service.updateCleanup({
      ...auth,
      taskId: "update-e2e",
      idempotencyKey: "cleanup-once",
      retain: 2,
      dryRun: true
    })).retain, 2);
    await service.close();
  });
});


test("service registers, leases, starts, cycles, and revokes a real hash-bound runtime", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const service = await new HpMhaSerenaService({ workspaceRoot, stateDirName: ".hermes-test" }).init();
    const binding = await service.bindWorkspace({ owner: "codex-test", ttlMs: 60_000 });
    const auth = { workspaceHandle: binding.token, owner: "codex-test" };
    await service.claimAndLock({ ...auth, taskId: "runtime-e2e", files: ["src/runtime.mjs"] });
    const executableSha256 = crypto.createHash("sha256").update(await readFile(process.execPath)).digest("hex");
    const registered = await service.runtimeRegister({
      ...auth,
      taskId: "runtime-e2e",
      manifest: {
        id: "fixture-runtime",
        command: [process.execPath, "-e", "setInterval(() => {}, 1000)"],
        executable_sha256: executableSha256,
        tools: ["fixture.read"],
        permissions: ["workspace:read"]
      }
    });
    assert.equal(registered.runtime.enabled, false);
    assert.equal(registered.evidence.kind, "runtime.register");
    const issued = await service.runtimeIssueLease({ ...auth, taskId: "runtime-e2e", runtimeId: "fixture-runtime", permissions: ["workspace:read"], ttlSeconds: 60 });
    const otherBinding = await service.bindWorkspace({ owner: "other-owner", ttlMs: 60_000 });
    const otherAuth = { workspaceHandle: otherBinding.token, owner: "other-owner" };
    assert.deepEqual((await service.runtimeStatus(otherAuth)).leases, []);
    await assert.rejects(
      service.runtimeEnable({ ...otherAuth, runtimeId: "fixture-runtime", leaseId: issued.lease.id }),
      /matching active runtime lease/i
    );
    const enabled = await service.runtimeEnable({ ...auth, runtimeId: "fixture-runtime", leaseId: issued.lease.id });
    assert.equal(enabled.runtime.enabled, true);
    assert.ok(Number.isInteger(enabled.runtime.pid));
    await service.manager.releaseTask({ owner: "codex-test", taskId: "runtime-e2e", note: "task finished" });
    await assert.rejects(
      service.runtimeCycle({ ...auth, runtimeId: "fixture-runtime", leaseId: issued.lease.id }),
      (error) => error instanceof HpMhaSerenaError && error.code === "ACTIVE_TASK_REQUIRED"
    );
    await service.manager.claimTask({ owner: "codex-test", taskId: "runtime-e2e", files: ["src/runtime.mjs"] });
    const cycled = await service.runtimeCycle({ ...auth, runtimeId: "fixture-runtime", leaseId: issued.lease.id });
    assert.equal(cycled.runtime.generation, 2);
    const revoked = await service.runtimeRevokeLease({ ...auth, leaseId: issued.lease.id });
    assert.equal(revoked.lease.status, "revoked");
    assert.equal((await service.runtimeStatus(auth)).runtimes[0].enabled, false);
    await service.close();
  });
});
