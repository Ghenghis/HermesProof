import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  canonicalJSON,
  normalizeWorkspacePath,
  sha256Hex
} from "../core/fs-utils.mjs";
import { HermesLockManager } from "../core/lock-manager.mjs";
import {
  WorkspaceBindingManager,
  loadOrCreateWorkspaceBindingSecret
} from "../core/workspace-binding.mjs";
import { SerenaAdapter } from "./serena-adapter.mjs";

export class HpMhaSerenaError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "HpMhaSerenaError";
    this.code = code;
    this.details = details;
  }
}

export class HpMhaSerenaService {
  constructor({
    workspaceRoot,
    stateDirName,
    serenaAdapterFactory = (options) => new SerenaAdapter(options),
    receiptTtlMs = 300_000,
    now = () => Date.now()
  } = {}) {
    if (typeof workspaceRoot !== "string" || workspaceRoot.trim().length === 0) {
      throw new TypeError("workspaceRoot is required");
    }
    if (typeof serenaAdapterFactory !== "function") {
      throw new TypeError("serenaAdapterFactory must be a function");
    }
    if (!Number.isFinite(receiptTtlMs) || receiptTtlMs <= 0) {
      throw new TypeError("receiptTtlMs must be a positive number");
    }
    this.requestedWorkspaceRoot = path.resolve(workspaceRoot);
    this.stateDirName = stateDirName;
    this.serenaAdapterFactory = serenaAdapterFactory;
    this.receiptTtlMs = receiptTtlMs;
    this.now = now;
    this.workspaceRoot = null;
    this.manager = null;
    this.bindingManager = null;
    this.serenaAdapter = null;
    this.receipts = new Map();
    this.initialized = false;
  }

  async init() {
    if (this.initialized) {
      return this;
    }
    this.workspaceRoot = await fs.realpath(this.requestedWorkspaceRoot);
    this.manager = new HermesLockManager({
      workspaceRoot: this.workspaceRoot,
      stateDirName: this.stateDirName
    });
    await this.manager.init();
    const secret = await loadOrCreateWorkspaceBindingSecret(this.manager.paths.stateDir);
    this.bindingManager = new WorkspaceBindingManager({ secret });
    this.initialized = true;
    return this;
  }

  assertInitialized() {
    if (!this.initialized || !this.manager || !this.bindingManager) {
      throw new Error("HpMhaSerenaService.init() must complete before use");
    }
  }

  async policyDigest() {
    this.assertInitialized();
    return sha256Hex(canonicalJSON(await this.manager.getPolicy()));
  }

  async bindWorkspace({ owner, ttlMs } = {}) {
    this.assertInitialized();
    return this.bindingManager.bind({
      workspaceRoot: this.workspaceRoot,
      principal: owner,
      policyDigest: await this.policyDigest(),
      ttlMs
    });
  }

  async verifyWorkspaceHandle({ workspaceHandle, owner } = {}) {
    this.assertInitialized();
    return this.bindingManager.verify({
      token: workspaceHandle,
      workspaceRoot: this.workspaceRoot,
      principal: owner,
      policyDigest: await this.policyDigest()
    });
  }

  async claimAndLock({
    workspaceHandle,
    owner,
    role = "agent",
    taskId,
    title = "",
    files,
    reason = "",
    ttlMinutes
  } = {}) {
    const binding = await this.verifyWorkspaceHandle({ workspaceHandle, owner });
    const task = await this.manager.claimTask({
      owner,
      role,
      taskId,
      title,
      files,
      reason
    });
    if (!task.ok) {
      return {
        ...task,
        workspace_handle_id: binding.handle_id
      };
    }

    const lock = await this.manager.lockFiles({
      owner,
      role,
      taskId: task.task.id,
      files,
      reason,
      ttlMinutes
    });
    if (!lock.ok) {
      const rollback = await this.manager.releaseTask({
        owner,
        taskId: task.task.id,
        note: "Rolled back because exact-file lock acquisition failed"
      });
      return {
        ...lock,
        task_rollback: rollback,
        workspace_handle_id: binding.handle_id
      };
    }

    return {
      ok: true,
      status: "locked",
      task: task.task,
      locks: lock.locks,
      files: lock.files,
      workspace_handle_id: binding.handle_id
    };
  }

  async getSerenaAdapter() {
    this.assertInitialized();
    if (!this.serenaAdapter) {
      this.serenaAdapter = this.serenaAdapterFactory({
        workspaceRoot: this.workspaceRoot
      });
      await this.serenaAdapter.connect();
    }
    return this.serenaAdapter;
  }

  pruneReceipts() {
    const now = this.now();
    for (const [id, receipt] of this.receipts) {
      if (receipt.expires_at_ms <= now) {
        this.receipts.delete(id);
      }
    }
  }

  async serenaHealth({ workspaceHandle, owner } = {}) {
    const binding = await this.verifyWorkspaceHandle({ workspaceHandle, owner });
    const adapter = await this.getSerenaAdapter();
    return {
      ...adapter.health(),
      ok: true,
      workspace_handle_id: binding.handle_id
    };
  }

  async semanticInspect({
    workspaceHandle,
    owner,
    tool,
    arguments: toolArguments = {}
  } = {}) {
    const binding = await this.verifyWorkspaceHandle({ workspaceHandle, owner });
    if (!toolArguments || typeof toolArguments !== "object" || Array.isArray(toolArguments)) {
      throw new HpMhaSerenaError(
        "INVALID_SERENA_ARGUMENTS",
        "arguments must be an object"
      );
    }
    const adapter = await this.getSerenaAdapter();
    const semantic = await adapter.callSemantic(tool, toolArguments);

    let receipt = null;
    const requestedFile = toolArguments.relative_path || toolArguments.reference_file;
    if (typeof requestedFile === "string" && requestedFile.trim()) {
      const file = normalizeWorkspacePath(this.workspaceRoot, requestedFile);
      const absoluteFile = path.join(this.workspaceRoot, file);
      const stat = await fs.stat(absoluteFile).catch(() => null);
      if (!stat?.isFile()) {
        throw new HpMhaSerenaError(
          "SEMANTIC_RECEIPT_FILE_REQUIRED",
          "Semantic edit receipts require an existing exact source file",
          { file }
        );
      }
      const source = await fs.readFile(absoluteFile);
      const issuedAt = this.now();
      receipt = {
        id: "sr_" + crypto.randomBytes(16).toString("hex"),
        owner,
        workspace_handle_id: binding.handle_id,
        file,
        source_sha256: sha256Hex(source),
        semantic_tool: tool,
        issued_at_ms: issuedAt,
        expires_at_ms: issuedAt + this.receiptTtlMs
      };
      this.pruneReceipts();
      this.receipts.set(receipt.id, receipt);
    }

    return {
      ok: true,
      status: "analyzed",
      semantic,
      receipt,
      workspace_handle_id: binding.handle_id
    };
  }

  async writeTextAtomic(file, text) {
    const temporary =
      file + "." + process.pid + "." + crypto.randomBytes(12).toString("hex") + ".tmp";
    try {
      await fs.writeFile(temporary, text, "utf8");
      await fs.rename(temporary, file);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  async guardedReplace({
    workspaceHandle,
    owner,
    taskId,
    receiptId,
    file: requestedFile,
    oldText,
    newText
  } = {}) {
    const binding = await this.verifyWorkspaceHandle({ workspaceHandle, owner });
    this.pruneReceipts();
    const receipt = this.receipts.get(receiptId);
    if (!receipt) {
      throw new HpMhaSerenaError(
        "SEMANTIC_RECEIPT_UNKNOWN",
        "Semantic receipt is missing, expired, or already consumed"
      );
    }
    if (
      receipt.owner !== owner ||
      receipt.workspace_handle_id !== binding.handle_id
    ) {
      throw new HpMhaSerenaError(
        "SEMANTIC_RECEIPT_SCOPE_MISMATCH",
        "Semantic receipt belongs to another principal or workspace handle"
      );
    }

    const file = normalizeWorkspacePath(this.workspaceRoot, requestedFile);
    if (receipt.file !== file) {
      throw new HpMhaSerenaError(
        "SEMANTIC_RECEIPT_FILE_MISMATCH",
        "Semantic receipt does not authorize the requested file",
        { receipt_file: receipt.file, requested_file: file }
      );
    }

    const locks = await this.manager.listLocks();
    const exactLock = locks.locks.find((lock) =>
      lock.file === file &&
      lock.owner === owner &&
      lock.task_id === taskId &&
      !lock.is_stale
    );
    if (!exactLock) {
      throw new HpMhaSerenaError(
        "EXACT_LOCK_REQUIRED",
        "A live exact-file lock owned by this principal and task is required",
        { file, owner, task_id: taskId }
      );
    }
    if (typeof oldText !== "string" || oldText.length === 0) {
      throw new HpMhaSerenaError(
        "INVALID_REPLACEMENT",
        "oldText must be a non-empty string"
      );
    }
    if (typeof newText !== "string") {
      throw new HpMhaSerenaError(
        "INVALID_REPLACEMENT",
        "newText must be a string"
      );
    }

    const absoluteFile = path.join(this.workspaceRoot, file);
    const source = await fs.readFile(absoluteFile, "utf8");
    const beforeSha = sha256Hex(source);
    if (beforeSha !== receipt.source_sha256) {
      throw new HpMhaSerenaError(
        "SOURCE_CHANGED_AFTER_ANALYSIS",
        "Source changed after semantic analysis; obtain a new receipt",
        {
          file,
          analyzed_sha256: receipt.source_sha256,
          current_sha256: beforeSha
        }
      );
    }

    let matchCount = 0;
    let offset = 0;
    while ((offset = source.indexOf(oldText, offset)) !== -1) {
      matchCount += 1;
      offset += oldText.length;
    }
    if (matchCount !== 1) {
      throw new HpMhaSerenaError(
        "REPLACEMENT_MATCH_COUNT",
        "Guarded replacement requires exactly one match",
        { file, match_count: matchCount }
      );
    }

    const next = source.replace(oldText, newText);
    const afterSha = sha256Hex(next);
    await this.writeTextAtomic(absoluteFile, next);
    let evidence;
    try {
      evidence = await this.manager.appendEvidence({
        owner,
        taskId,
        kind: "serena.safe_edit",
        summary: "Receipt-gated semantic edit: " + file,
        data: {
          file,
          lock_id: exactLock.lock_id,
          semantic_tool: receipt.semantic_tool,
          semantic_receipt_id: receipt.id,
          before_sha256: beforeSha,
          after_sha256: afterSha
        }
      });
    } catch (error) {
      await this.writeTextAtomic(absoluteFile, source).catch(() => {});
      throw new HpMhaSerenaError(
        "EVIDENCE_WRITE_FAILED",
        "Edit was rolled back because evidence could not be recorded",
        { cause: error?.message ?? String(error) }
      );
    }
    this.receipts.delete(receipt.id);
    return {
      ok: true,
      status: "edited",
      file,
      before_sha256: beforeSha,
      after_sha256: afterSha,
      semantic_receipt_id: receipt.id,
      workspace_handle_id: binding.handle_id,
      evidence: evidence.evidence
    };
  }

  async close() {
    const adapter = this.serenaAdapter;
    this.serenaAdapter = null;
    this.receipts.clear();
    await adapter?.close();
  }

  async status({ workspaceHandle, owner } = {}) {
    const binding = await this.verifyWorkspaceHandle({ workspaceHandle, owner });
    const summary = await this.manager.getStateSummary();
    return {
      ...summary,
      ok: true,
      workspace_root: this.workspaceRoot,
      workspace_handle_id: binding.handle_id
    };
  }

  async release({
    workspaceHandle,
    owner,
    taskId,
    files,
    note = ""
  } = {}) {
    const binding = await this.verifyWorkspaceHandle({ workspaceHandle, owner });
    const fileRelease = await this.manager.releaseFiles({ owner, files, note });
    if (!fileRelease.ok) {
      return {
        ok: false,
        status: "partial",
        files: fileRelease,
        task: null,
        workspace_handle_id: binding.handle_id
      };
    }
    const taskRelease = await this.manager.releaseTask({ owner, taskId, note });
    return {
      ok: fileRelease.ok && taskRelease.ok,
      status: fileRelease.ok && taskRelease.ok ? "released" : "partial",
      files: fileRelease,
      task: taskRelease,
      workspace_handle_id: binding.handle_id
    };
  }
}
