import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  canonicalJSON,
  normalizeWorkspacePath,
  sha256Hex
} from "../core/fs-utils.mjs";
import { AutomationManager } from "../core/automation-manager.mjs";
import { CapabilityPackManager } from "../core/capability-packs.mjs";
import { createLocalCapabilityInstaller } from "../core/local-capability-installer.mjs";
import { createLocalProcessAdapter } from "../core/local-process-adapter.mjs";
import { createSystemSchedulerAdapter } from "../core/system-scheduler-adapter.mjs";
import {
  KILO_BACKEND_CAPABILITY_PACK,
  createKiloBackendInstallPlan,
  probeKiloBackend
} from "../core/kilo-backend-kit.mjs";
import { REVERSE_ENGINEERING_CAPABILITY_PACK } from "../core/reverse-engineering-kit.mjs";
import { HermesLockManager } from "../core/lock-manager.mjs";
import { RuntimeLifecycleManager } from "../core/runtime-lifecycle-manager.mjs";
import {
  WorkspaceBindingManager,
  loadOrCreateWorkspaceBindingSecret
} from "../core/workspace-binding.mjs";
import { SerenaAdapter } from "./serena-adapter.mjs";
import {
  SERENA_CATALOG,
  SERENA_COMMIT,
  SERENA_DEFAULT_DIRECT_TOOLS,
  SERENA_DEFAULT_GUARDED_TOOLS,
  SERENA_JETBRAINS_DIRECT_TOOLS,
  SERENA_JETBRAINS_GUARDED_TOOLS,
  SERENA_OPTIONAL_DIRECT_TOOLS,
  SERENA_OPTIONAL_GUARDED_TOOLS,
  SERENA_QUERY_GUARDED_TOOLS,
  SERENA_SELECTED_LSP_TOOLS,
  SERENA_SOURCE,
  SERENA_TOOL_ROUTES,
  SERENA_VERSION
} from "./serena-catalog.mjs";
import { SERENA_CONTEXT_NAMES } from "./context-installer.mjs";

export const UPDATE_OPERATION_FILE = ".hermesproof/operations/update.lock";

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
    runtimeManagerFactory = (options) => new RuntimeLifecycleManager({
      ...options,
      processAdapter: createLocalProcessAdapter(options)
    }),
    capabilityManagerFactory = (options) => new CapabilityPackManager(options),
    automationManagerFactory = (options) => new AutomationManager({
      ...options,
      schedulerAdapter: createSystemSchedulerAdapter()
    }),
    capabilityInstaller,
    kiloProbe = probeKiloBackend,
    updateManagerFactory = null,
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
    this.runtimeManagerFactory = runtimeManagerFactory;
    this.capabilityManagerFactory = capabilityManagerFactory;
    this.automationManagerFactory = automationManagerFactory;
    this.capabilityInstaller = capabilityInstaller;
    this.kiloProbe = kiloProbe;
    this.updateManagerFactory = updateManagerFactory;
    this.receiptTtlMs = receiptTtlMs;
    this.now = now;
    this.workspaceRoot = null;
    this.manager = null;
    this.bindingManager = null;
    this.serenaAdapter = null;
    this.runtimeManager = null;
    this.capabilityManager = null;
    this.automationManager = null;
    this.updateManager = null;
    this.updateOperations = new Map();
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
    this.runtimeManager = this.runtimeManagerFactory({ workspaceRoot: this.workspaceRoot });
    await this.runtimeManager.init();
    this.capabilityManager = this.capabilityManagerFactory({
      workspaceRoot: this.workspaceRoot,
      catalog: [KILO_BACKEND_CAPABILITY_PACK, REVERSE_ENGINEERING_CAPABILITY_PACK],
      installer: this.capabilityInstaller || createLocalCapabilityInstaller({ workspaceRoot: this.workspaceRoot })
    });
    await this.capabilityManager.init();
    this.automationManager = this.automationManagerFactory({
      workspaceRoot: this.workspaceRoot,
      leaseVerifier: async ({ runtimeId, leaseId }) => {
        const status = await this.runtimeManager.status();
        return status.leases.some((lease) =>
          lease.id === leaseId &&
          lease.runtime_id === runtimeId &&
          lease.status === "active" &&
          lease.expires_at_ms > this.now()
        );
      }
    });
    if (this.updateManagerFactory) {
      this.updateManager = await this.updateManagerFactory({
        workspaceRoot: this.workspaceRoot,
        stateDirectory: this.manager.paths.stateDir
      });
    }
    for (const job of [
      {
        id: "deep-doctor",
        description: "Run the governed HermesProof deep doctor",
        runtime_id: "hermesproof",
        action: "doctor.deep",
        interval_minutes: 15,
        timeout_seconds: 300,
        retries: 2
      },
      {
        id: "disable-unused-mcp",
        description: "Disable runtimes whose bounded lease expired",
        runtime_id: "hermesproof",
        action: "runtime.disable-unused",
        interval_minutes: 5,
        timeout_seconds: 60,
        retries: 1
      },
      {
        id: "completion-pulse",
        description: "Recompute missing acceptance evidence",
        runtime_id: "hermesproof",
        action: "completion.pulse",
        interval_minutes: 10,
        timeout_seconds: 180,
        retries: 1
      }
    ]) this.automationManager.register(job);
    this.runtimeReaper = setInterval(() => {
      this.runtimeManager.disableUnused().catch(() => {});
    }, 60_000);
    this.runtimeReaper.unref?.();
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

  async catalog({ workspaceHandle, owner } = {}) {
    const binding = await this.verifyWorkspaceHandle({ workspaceHandle, owner });
    const desktopActive = [
      ...SERENA_DEFAULT_DIRECT_TOOLS,
      ...SERENA_DEFAULT_GUARDED_TOOLS
    ];
    const optionalOrBackendSpecific = [
      ...SERENA_OPTIONAL_DIRECT_TOOLS,
      ...SERENA_OPTIONAL_GUARDED_TOOLS,
      ...SERENA_QUERY_GUARDED_TOOLS,
      ...SERENA_JETBRAINS_DIRECT_TOOLS,
      ...SERENA_JETBRAINS_GUARDED_TOOLS
    ];
    return {
      ok: true,
      schema: "hermesproof.serena.catalog.v1",
      runtime: {
        version: SERENA_VERSION,
        commit: SERENA_COMMIT,
        source: SERENA_SOURCE,
        backend: "lsp"
      },
      counts: {
        catalogued: SERENA_CATALOG.length,
        desktop_active: desktopActive.length,
        optional_or_backend_specific: optionalOrBackendSpecific.length,
        governed_lsp_active: SERENA_SELECTED_LSP_TOOLS.length,
        raw_mutation_active: 0
      },
      profiles: {
        desktop_active: desktopActive,
        optional_or_backend_specific: optionalOrBackendSpecific,
        governed_lsp_active: SERENA_SELECTED_LSP_TOOLS
      },
      routes: SERENA_TOOL_ROUTES,
      custom_contexts: [...SERENA_CONTEXT_NAMES],
      notes: [
        "52 is the pinned executable catalogue, not one simultaneously active profile.",
        "29 is Serena desktop-app default: 14 read/analysis tools plus 15 direct-authority tools.",
        "HermesProof exposes 15 LSP read/analysis tools and keeps raw Serena mutations at zero.",
        "JetBrains and query-project tools require their matching backend or mode."
      ],
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

  async writeTextExclusive(file, text) {
    const temporary =
      file + "." + process.pid + "." + crypto.randomBytes(12).toString("hex") + ".tmp";
    try {
      await fs.writeFile(temporary, text, { encoding: "utf8", flag: "wx" });
      try {
        await fs.link(temporary, file);
      } catch (error) {
        if (error?.code !== "EPERM" && error?.code !== "ENOTSUP") throw error;
        await fs.copyFile(temporary, file, fs.constants.COPYFILE_EXCL);
      }
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
  }

  async guardedCreate({
    workspaceHandle,
    owner,
    taskId,
    file: requestedFile,
    text
  } = {}) {
    const binding = await this.verifyWorkspaceHandle({ workspaceHandle, owner });
    const file = normalizeWorkspacePath(this.workspaceRoot, requestedFile);
    if (typeof text !== "string") {
      throw new HpMhaSerenaError("INVALID_CREATE", "text must be a string");
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
    const absoluteFile = path.join(this.workspaceRoot, file);
    const parent = await fs.stat(path.dirname(absoluteFile)).catch(() => null);
    if (!parent?.isDirectory()) {
      throw new HpMhaSerenaError(
        "PARENT_DIRECTORY_REQUIRED",
        "The parent directory must already exist",
        { file }
      );
    }
    const exists = await fs.stat(absoluteFile).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (exists) {
      throw new HpMhaSerenaError("FILE_EXISTS", "Guarded create never overwrites an existing path", { file });
    }
    const afterSha = sha256Hex(text);
    try {
      await this.writeTextExclusive(absoluteFile, text);
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new HpMhaSerenaError("FILE_EXISTS", "Guarded create lost an exclusive-create race", { file });
      }
      throw error;
    }
    let evidence;
    try {
      evidence = await this.manager.appendEvidence({
        owner,
        taskId,
        kind: "serena.safe_create",
        summary: "Exact-lock guarded create: " + file,
        data: {
          file,
          lock_id: exactLock.lock_id,
          after_sha256: afterSha
        }
      });
    } catch (error) {
      const current = await fs.readFile(absoluteFile).catch(() => null);
      if (current && sha256Hex(current) === afterSha) {
        await fs.rm(absoluteFile, { force: true }).catch(() => {});
      }
      throw new HpMhaSerenaError(
        "EVIDENCE_WRITE_FAILED",
        "Create was rolled back because evidence could not be recorded",
        { cause: error?.message ?? String(error) }
      );
    }
    return {
      ok: true,
      status: "created",
      file,
      after_sha256: afterSha,
      workspace_handle_id: binding.handle_id,
      evidence: evidence.evidence
    };
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

  async requireClaimedTask(owner, taskId) {
    if (typeof taskId !== "string" || taskId.length === 0) {
      throw new HpMhaSerenaError("ACTIVE_TASK_REQUIRED", "A claimed HermesProof task is required");
    }
    const summary = await this.manager.getStateSummary();
    const task = summary.tasks.find((item) =>
      item?.id === taskId && item?.owner === owner && item?.status === "claimed"
    );
    if (!task) {
      throw new HpMhaSerenaError(
        "ACTIVE_TASK_REQUIRED",
        "A matching claimed HermesProof task is required for this mutation",
        { owner, task_id: taskId }
      );
    }
    return task;
  }

  async runtimeRegister({ workspaceHandle, owner, taskId, manifest } = {}) {
    const binding = await this.verifyWorkspaceHandle({ workspaceHandle, owner });
    await this.requireClaimedTask(owner, taskId);
    const result = await this.runtimeManager.register(manifest);
    const evidence = await this.manager.appendEvidence({
      owner,
      taskId,
      kind: "runtime.register",
      summary: "Registered default-disabled runtime: " + result.runtime.id,
      data: {
        runtime_id: result.runtime.id,
        executable_sha256: result.runtime.manifest.executable_sha256,
        tools: result.runtime.manifest.tools,
        permissions: result.runtime.manifest.permissions
      }
    });
    return { ...result, evidence: evidence.evidence, workspace_handle_id: binding.handle_id };
  }

  async runtimeStatus({ workspaceHandle, owner } = {}) {
    const binding = await this.verifyWorkspaceHandle({ workspaceHandle, owner });
    return { ...(await this.runtimeManager.status()), workspace_handle_id: binding.handle_id };
  }

  async runtimeIssueLease({ workspaceHandle, owner, taskId, runtimeId, permissions, ttlSeconds } = {}) {
    const binding = await this.verifyWorkspaceHandle({ workspaceHandle, owner });
    await this.requireClaimedTask(owner, taskId);
    return {
      ...(await this.runtimeManager.issueLease({
        runtimeId,
        workspace: this.workspaceRoot,
        owner,
        taskId,
        permissions,
        ttlMs: ttlSeconds * 1000
      })),
      workspace_handle_id: binding.handle_id
    };
  }

  async runtimeEnable({ workspaceHandle, owner, runtimeId, leaseId } = {}) {
    const binding = await this.verifyWorkspaceHandle({ workspaceHandle, owner });
    return {
      ...(await this.runtimeManager.enable({ runtimeId, leaseId })),
      workspace_handle_id: binding.handle_id
    };
  }

  async runtimeCycle({ workspaceHandle, owner, runtimeId, leaseId } = {}) {
    const binding = await this.verifyWorkspaceHandle({ workspaceHandle, owner });
    return {
      ...(await this.runtimeManager.cycle({ runtimeId, leaseId })),
      workspace_handle_id: binding.handle_id
    };
  }

  async runtimeRevokeLease({ workspaceHandle, owner, leaseId } = {}) {
    const binding = await this.verifyWorkspaceHandle({ workspaceHandle, owner });
    return {
      ...(await this.runtimeManager.revokeLease({ leaseId })),
      workspace_handle_id: binding.handle_id
    };
  }

  async runtimeDisableUnused({ workspaceHandle, owner } = {}) {
    const binding = await this.verifyWorkspaceHandle({ workspaceHandle, owner });
    return {
      ...(await this.runtimeManager.disableUnused()),
      workspace_handle_id: binding.handle_id
    };
  }

  async capabilityResolve({ workspaceHandle, owner, requiredCapabilities } = {}) {
    const binding = await this.verifyWorkspaceHandle({ workspaceHandle, owner });
    return {
      ...this.capabilityManager.resolve(requiredCapabilities),
      workspace_handle_id: binding.handle_id
    };
  }

  async capabilityPlan({ workspaceHandle, owner, packId } = {}) {
    const binding = await this.verifyWorkspaceHandle({ workspaceHandle, owner });
    return {
      ok: true,
      ...this.capabilityManager.plan(packId),
      workspace_handle_id: binding.handle_id
    };
  }

  async capabilityInstall({ workspaceHandle, owner, taskId, packId, apply = false } = {}) {
    const binding = await this.verifyWorkspaceHandle({ workspaceHandle, owner });
    if (apply) await this.requireClaimedTask(owner, taskId);
    return {
      ...(await this.capabilityManager.install({ packId, apply })),
      workspace_handle_id: binding.handle_id
    };
  }

  async automationStatus({ workspaceHandle, owner } = {}) {
    const binding = await this.verifyWorkspaceHandle({ workspaceHandle, owner });
    return {
      ...this.automationManager.status(),
      workspace_handle_id: binding.handle_id
    };
  }

  async automationPlan({ workspaceHandle, owner, jobId, platform } = {}) {
    const binding = await this.verifyWorkspaceHandle({ workspaceHandle, owner });
    return {
      ok: true,
      ...this.automationManager.plan({ jobId, platform }),
      workspace_handle_id: binding.handle_id
    };
  }

  async automationEnable({ workspaceHandle, owner, jobId, platform, leaseId } = {}) {
    const binding = await this.verifyWorkspaceHandle({ workspaceHandle, owner });
    return {
      ...(await this.automationManager.enable({ jobId, platform, leaseId })),
      workspace_handle_id: binding.handle_id
    };
  }

  async automationCycle({ workspaceHandle, owner, jobId, platform, leaseId } = {}) {
    const binding = await this.verifyWorkspaceHandle({ workspaceHandle, owner });
    return {
      ...(await this.automationManager.cycle({ jobId, platform, leaseId })),
      workspace_handle_id: binding.handle_id
    };
  }

  async automationKillSwitch({ workspaceHandle, owner, reason } = {}) {
    const binding = await this.verifyWorkspaceHandle({ workspaceHandle, owner });
    return {
      ...(await this.automationManager.killSwitch({ reason })),
      workspace_handle_id: binding.handle_id
    };
  }

  async kiloBackendDoctor({
    workspaceHandle,
    owner,
    extensionVersion,
    bundledKiloPath,
    indexing = {},
    integrations = {}
  } = {}) {
    const binding = await this.verifyWorkspaceHandle({ workspaceHandle, owner });
    const result = await this.kiloProbe({
      extensionVersion,
      bundledKiloPath,
      indexing,
      integrations: {
        hermesproof: true,
        serena: true,
        mcp_config: true,
        ...integrations
      }
    });
    return { ...result, workspace_handle_id: binding.handle_id };
  }

  async kiloBackendPlan({ workspaceHandle, owner, report } = {}) {
    const binding = await this.verifyWorkspaceHandle({ workspaceHandle, owner });
    return {
      ok: true,
      ...createKiloBackendInstallPlan({ report, workspaceRoot: this.workspaceRoot }),
      workspace_handle_id: binding.handle_id
    };
  }

  requireUpdateManager() {
    if (!this.updateManager) {
      throw new HpMhaSerenaError(
        "UPDATE_MANAGER_UNAVAILABLE",
        "The managed updater is not configured for this installation"
      );
    }
    return this.updateManager;
  }

  async requireUpdateOperationLock(owner, taskId) {
    await this.requireClaimedTask(owner, taskId);
    const locks = await this.manager.listLocks();
    const lock = locks.locks.find((item) =>
      item.file === UPDATE_OPERATION_FILE &&
      item.owner === owner &&
      item.task_id === taskId &&
      !item.is_stale
    );
    if (!lock) {
      throw new HpMhaSerenaError(
        "EXACT_UPDATE_LOCK_REQUIRED",
        "A live exact lock on " + UPDATE_OPERATION_FILE + " is required",
        { file: UPDATE_OPERATION_FILE, owner, task_id: taskId }
      );
    }
    return lock;
  }

  async runUpdateMutation({
    workspaceHandle,
    owner,
    taskId,
    idempotencyKey,
    operation,
    payload = {},
    action
  }) {
    const binding = await this.verifyWorkspaceHandle({ workspaceHandle, owner });
    const lock = await this.requireUpdateOperationLock(owner, taskId);
    if (
      typeof idempotencyKey !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(idempotencyKey)
    ) {
      throw new HpMhaSerenaError(
        "INVALID_IDEMPOTENCY_KEY",
        "idempotencyKey must be 8-128 safe characters"
      );
    }
    const key = [owner, taskId, operation, idempotencyKey].join(":");
    const payloadDigest = sha256Hex(canonicalJSON(payload));
    const existing = this.updateOperations.get(key);
    if (existing) {
      if (existing.payloadDigest !== payloadDigest) {
        throw new HpMhaSerenaError(
          "IDEMPOTENCY_PAYLOAD_MISMATCH",
          "The idempotency key was already used with different arguments"
        );
      }
      return await existing.promise;
    }
    const promise = (async () => {
      const result = await action(this.requireUpdateManager());
      const evidence = await this.manager.appendEvidence({
        owner,
        taskId,
        kind: "updater." + operation,
        summary: "Governed updater operation: " + operation,
        data: {
          operation,
          idempotency_key_sha256: sha256Hex(idempotencyKey),
          payload_sha256: payloadDigest,
          update_result_sha256: sha256Hex(canonicalJSON(result)),
          operation_lock_id: lock.lock_id
        }
      });
      return {
        ...result,
        workspace_handle_id: binding.handle_id,
        updater_evidence: evidence.evidence
      };
    })();
    this.updateOperations.set(key, { payloadDigest, promise });
    if (this.updateOperations.size > 1_000) {
      this.updateOperations.delete(this.updateOperations.keys().next().value);
    }
    return await promise;
  }

  async updateStatus({ workspaceHandle, owner } = {}) {
    const binding = await this.verifyWorkspaceHandle({ workspaceHandle, owner });
    return {
      ...(await this.requireUpdateManager().status()),
      workspace_handle_id: binding.handle_id
    };
  }

  async updateCheck({ workspaceHandle, owner } = {}) {
    const binding = await this.verifyWorkspaceHandle({ workspaceHandle, owner });
    return {
      ...(await this.requireUpdateManager().check()),
      workspace_handle_id: binding.handle_id
    };
  }

  async updateEvidence({ workspaceHandle, owner, sha } = {}) {
    const binding = await this.verifyWorkspaceHandle({ workspaceHandle, owner });
    return {
      ...(await this.requireUpdateManager().evidence({ sha })),
      workspace_handle_id: binding.handle_id
    };
  }

  async updateApply(options = {}) {
    return await this.runUpdateMutation({
      ...options,
      operation: "apply",
      action: (manager) => manager.apply()
    });
  }

  async updateRollback(options = {}) {
    return await this.runUpdateMutation({
      ...options,
      operation: "rollback",
      action: (manager) => manager.rollback()
    });
  }

  async updateChannel({ channel, acknowledgePreview = false, ...options } = {}) {
    const payload = { channel, acknowledgePreview };
    return await this.runUpdateMutation({
      ...options,
      operation: "channel",
      payload,
      action: (manager) => manager.channel(payload)
    });
  }

  async updateAuto({
    enabled,
    cadenceHours,
    jitterMinutes,
    maintenanceWindowUtc = null,
    ...options
  } = {}) {
    const payload = { enabled, cadenceHours, jitterMinutes, maintenanceWindowUtc };
    return await this.runUpdateMutation({
      ...options,
      operation: "auto",
      payload,
      action: (manager) => manager.configureAuto(payload)
    });
  }

  async updateCleanup({ retain = 2, dryRun = true, ...options } = {}) {
    const payload = { retain, dryRun };
    return await this.runUpdateMutation({
      ...options,
      operation: "cleanup",
      payload,
      action: (manager) => manager.cleanup(payload)
    });
  }

  async close() {
    if (this.runtimeReaper) {
      clearInterval(this.runtimeReaper);
      this.runtimeReaper = null;
    }
    const adapter = this.serenaAdapter;
    this.serenaAdapter = null;
    this.receipts.clear();
    this.updateOperations.clear();
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
