#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod4";

import { createProductionUpdateManager } from "../updater/production-update-manager.mjs";
import { SERENA_SELECTED_LSP_TOOLS } from "./serena-catalog.mjs";
import { HpMhaSerenaService } from "./service.mjs";

const resultSchema = z.looseObject({
  ok: z.boolean()
});

function toolResult(value, isError = false) {
  return {
    content: [{
      type: "text",
      text: JSON.stringify(value, null, 2)
    }],
    structuredContent: value,
    ...(isError ? { isError: true } : {})
  };
}

function toolError(error) {
  const value = {
    ok: false,
    code: typeof error?.code === "string" ? error.code : "INTERNAL_ERROR",
    message: error?.message ?? String(error)
  };
  return toolResult(value, true);
}

async function executeTool(operation) {
  try {
    const value = await operation();
    return toolResult(value, value?.ok === false);
  } catch (error) {
    return toolError(error);
  }
}

export function buildHpMhaSerenaServer({ service, era = "unknown" } = {}) {
  if (!service) {
    throw new TypeError("service is required");
  }
  const server = new McpServer(
    {
      name: "hp-mha-serena",
      version: "0.8.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  const workspaceAuth = {
    workspace_handle: z.string().min(1),
    owner: z.string().trim().min(1).max(128)
  };
  const updateMutationAuth = {
    ...workspaceAuth,
    task_id: z.string().trim().min(1).max(128),
    idempotency_key: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/)
  };
  const managerTools = [
    {
      name: "hp_mha_runtime_status",
      title: "Read managed MCP runtime status",
      description: "List registered runtimes and bounded leases. Unused servers remain disabled by default.",
      inputSchema: z.object({ ...workspaceAuth }),
      readOnly: true,
      idempotent: true,
      call: (input) => service.runtimeStatus({
        workspaceHandle: input.workspace_handle,
        owner: input.owner
      })
    },
    {
      name: "hp_mha_runtime_register",
      title: "Register a hash-bound MCP runtime",
      description: "Register one absolute executable and optional hashed entrypoint under a claimed HermesProof task. Registration is evidence-backed and remains disabled.",
      inputSchema: z.object({
        ...workspaceAuth,
        task_id: z.string().trim().min(1).max(128),
        manifest: z.object({
          id: z.string().trim().regex(/^[a-z0-9][a-z0-9._-]*$/i).max(128),
          command: z.array(z.string().min(1).max(4096)).min(1).max(64),
          executable_sha256: z.string().regex(/^[a-f0-9]{64}$/i),
          entrypoint_sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
          tools: z.array(z.string().trim().min(1).max(256)).max(500),
          permissions: z.array(z.string().trim().min(1).max(256)).max(100)
        }).strict()
      }),
      call: (input) => service.runtimeRegister({
        workspaceHandle: input.workspace_handle,
        owner: input.owner,
        taskId: input.task_id,
        manifest: input.manifest
      })
    },
    {
      name: "hp_mha_runtime_disable_unused",
      title: "Disable runtimes without active leases",
      description: "Stop every managed MCP runtime whose workspace, owner, task, and time-bounded lease is no longer active.",
      inputSchema: z.object({ ...workspaceAuth }),
      idempotent: true,
      call: (input) => service.runtimeDisableUnused({
        workspaceHandle: input.workspace_handle,
        owner: input.owner
      })
    },
    {
      name: "hp_mha_runtime_issue_lease",
      title: "Issue a bounded runtime lease",
      description: "Issue least-privilege authority for one registered runtime only when a matching HermesProof task is claimed.",
      inputSchema: z.object({
        ...workspaceAuth,
        task_id: z.string().trim().min(1).max(128),
        runtime_id: z.string().trim().min(1).max(128),
        permissions: z.array(z.string().trim().min(1)).max(100),
        ttl_seconds: z.number().int().min(1).max(86_400).default(300)
      }),
      call: (input) => service.runtimeIssueLease({
        workspaceHandle: input.workspace_handle,
        owner: input.owner,
        taskId: input.task_id,
        runtimeId: input.runtime_id,
        permissions: input.permissions,
        ttlSeconds: input.ttl_seconds
      })
    },
    {
      name: "hp_mha_runtime_enable",
      title: "Enable one leased MCP runtime",
      description: "Start and health-check one registered runtime under its matching active lease. Startup fails closed.",
      inputSchema: z.object({
        ...workspaceAuth,
        runtime_id: z.string().trim().min(1).max(128),
        lease_id: z.string().trim().min(1).max(128)
      }),
      call: (input) => service.runtimeEnable({
        workspaceHandle: input.workspace_handle,
        owner: input.owner,
        runtimeId: input.runtime_id,
        leaseId: input.lease_id
      })
    },
    {
      name: "hp_mha_runtime_cycle",
      title: "Cycle one leased MCP runtime",
      description: "Stop, restart, and health-check one runtime without expanding its active lease.",
      inputSchema: z.object({
        ...workspaceAuth,
        runtime_id: z.string().trim().min(1).max(128),
        lease_id: z.string().trim().min(1).max(128)
      }),
      call: (input) => service.runtimeCycle({
        workspaceHandle: input.workspace_handle,
        owner: input.owner,
        runtimeId: input.runtime_id,
        leaseId: input.lease_id
      })
    },
    {
      name: "hp_mha_runtime_revoke_lease",
      title: "Revoke one runtime lease",
      description: "Revoke a bounded runtime lease and stop its runtime if active.",
      inputSchema: z.object({
        ...workspaceAuth,
        lease_id: z.string().trim().min(1).max(128)
      }),
      destructive: true,
      idempotent: true,
      call: (input) => service.runtimeRevokeLease({
        workspaceHandle: input.workspace_handle,
        owner: input.owner,
        leaseId: input.lease_id
      })
    },
    {
      name: "hp_mha_capability_resolve",
      title: "Resolve missing capabilities",
      description: "Select the smallest local zero-cost set of pinned capability packs for the requested abilities.",
      inputSchema: z.object({
        ...workspaceAuth,
        required_capabilities: z.array(z.string().trim().min(1)).min(1).max(100)
      }),
      readOnly: true,
      idempotent: true,
      call: (input) => service.capabilityResolve({
        workspaceHandle: input.workspace_handle,
        owner: input.owner,
        requiredCapabilities: input.required_capabilities
      })
    },
    {
      name: "hp_mha_capability_plan",
      title: "Plan an isolated capability-pack install",
      description: "Return the pinned source, sandbox path, permissions, health probe, rollback, and disabled-after-install state without mutation.",
      inputSchema: z.object({
        ...workspaceAuth,
        pack_id: z.string().trim().min(1).max(128)
      }),
      readOnly: true,
      idempotent: true,
      call: (input) => service.capabilityPlan({
        workspaceHandle: input.workspace_handle,
        owner: input.owner,
        packId: input.pack_id
      })
    },
    {
      name: "hp_mha_capability_install",
      title: "Plan or install one pinned capability pack",
      description: "Dry-run by default. Apply requires a matching claimed task, an isolated installer, exact source integrity, generated executable/SBOM hashes, and remains disabled.",
      inputSchema: z.object({
        ...workspaceAuth,
        task_id: z.string().trim().max(128).default(""),
        pack_id: z.string().trim().min(1).max(128),
        apply: z.boolean().default(false)
      }),
      call: (input) => service.capabilityInstall({
        workspaceHandle: input.workspace_handle,
        owner: input.owner,
        taskId: input.task_id,
        packId: input.pack_id,
        apply: input.apply
      })
    },
    {
      name: "hp_mha_automation_status",
      title: "Read governed automation jobs",
      description: "List safe recipe-based cron jobs. Jobs are disabled by default and never store raw secret-bearing commands.",
      inputSchema: z.object({ ...workspaceAuth }),
      readOnly: true,
      idempotent: true,
      call: (input) => service.automationStatus({
        workspaceHandle: input.workspace_handle,
        owner: input.owner
      })
    },
    {
      name: "hp_mha_automation_plan",
      title: "Plan Windows or VPS automation",
      description: "Render a non-mutating Windows Task Scheduler or Linux systemd timer plan for one registered recipe.",
      inputSchema: z.object({
        ...workspaceAuth,
        job_id: z.string().trim().min(1).max(128),
        platform: z.enum(["windows", "linux"])
      }),
      readOnly: true,
      idempotent: true,
      call: (input) => service.automationPlan({
        workspaceHandle: input.workspace_handle,
        owner: input.owner,
        jobId: input.job_id,
        platform: input.platform
      })
    },
    {
      name: "hp_mha_automation_enable",
      title: "Enable one leased automation job",
      description: "Enable one registered recipe only while its matching runtime lease is active.",
      inputSchema: z.object({
        ...workspaceAuth,
        job_id: z.string().trim().min(1).max(128),
        platform: z.enum(["windows", "linux"]),
        lease_id: z.string().trim().min(1).max(128)
      }),
      call: (input) => service.automationEnable({
        workspaceHandle: input.workspace_handle,
        owner: input.owner,
        jobId: input.job_id,
        platform: input.platform,
        leaseId: input.lease_id
      })
    },
    {
      name: "hp_mha_automation_cycle",
      title: "Cycle one leased automation job",
      description: "Disable then re-enable a registered automation recipe under the same active lease.",
      inputSchema: z.object({
        ...workspaceAuth,
        job_id: z.string().trim().min(1).max(128),
        platform: z.enum(["windows", "linux"]),
        lease_id: z.string().trim().min(1).max(128)
      }),
      call: (input) => service.automationCycle({
        workspaceHandle: input.workspace_handle,
        owner: input.owner,
        jobId: input.job_id,
        platform: input.platform,
        leaseId: input.lease_id
      })
    },
    {
      name: "hp_mha_automation_kill_switch",
      title: "Disable every active automation",
      description: "Operator kill switch for all active governed automation jobs.",
      inputSchema: z.object({
        ...workspaceAuth,
        reason: z.string().trim().min(1).max(500)
      }),
      destructive: true,
      idempotent: true,
      call: (input) => service.automationKillSwitch({
        workspaceHandle: input.workspace_handle,
        owner: input.owner,
        reason: input.reason
      })
    },
    {
      name: "hp_mha_kilo_backend_doctor",
      title: "Probe the Kilo RC25 backend kit",
      description: "Probe CLI fallback provenance, Node/Bun/Git providers, Docker engine state, Ollama and LM Studio loopback endpoints, indexing, and HermesProof integrations.",
      inputSchema: z.object({
        ...workspaceAuth,
        extension_version: z.string().trim().max(128).nullable().default(null),
        bundled_kilo_path: z.string().trim().max(2048).nullable().default(null),
        indexing: z.record(z.string(), z.boolean()).default({}),
        integrations: z.record(z.string(), z.boolean()).default({})
      }),
      readOnly: true,
      idempotent: false,
      call: (input) => service.kiloBackendDoctor({
        workspaceHandle: input.workspace_handle,
        owner: input.owner,
        extensionVersion: input.extension_version,
        bundledKiloPath: input.bundled_kilo_path,
        indexing: input.indexing,
        integrations: input.integrations
      })
    },
    {
      name: "hp_mha_kilo_backend_plan",
      title: "Plan Kilo backend gap replacement",
      description: "Compile a Kilo backend doctor report into minimal isolated, default-disabled capability packs and health probes.",
      inputSchema: z.object({
        ...workspaceAuth,
        report: z.record(z.string(), z.unknown())
      }),
      readOnly: true,
      idempotent: true,
      call: (input) => service.kiloBackendPlan({
        workspaceHandle: input.workspace_handle,
        owner: input.owner,
        report: input.report
      })
    },
    {
      name: "hp_mha_update_status",
      title: "Read managed release and auto-update status",
      description: "Read the active and previous immutable releases, channel, quarantine state, scheduler status, and last automatic update result.",
      inputSchema: z.object({ ...workspaceAuth }),
      readOnly: true,
      idempotent: true,
      call: (input) => service.updateStatus({
        workspaceHandle: input.workspace_handle,
        owner: input.owner
      })
    },
    {
      name: "hp_mha_update_check",
      title: "Check the allowlisted GitLab update channel",
      description: "Resolve the configured allowlisted GitLab ref to an exact SHA without staging or activating it.",
      inputSchema: z.object({ ...workspaceAuth }),
      readOnly: true,
      idempotent: true,
      call: (input) => service.updateCheck({
        workspaceHandle: input.workspace_handle,
        owner: input.owner
      })
    },
    {
      name: "hp_mha_update_evidence",
      title: "Read candidate verification evidence",
      description: "Read the digest-bound named-gate evidence for one exact release SHA.",
      inputSchema: z.object({
        ...workspaceAuth,
        sha: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/)
      }),
      readOnly: true,
      idempotent: true,
      call: (input) => service.updateEvidence({
        workspaceHandle: input.workspace_handle,
        owner: input.owner,
        sha: input.sha
      })
    },
    {
      name: "hp_mha_update_apply",
      title: "Verify and atomically activate an update",
      description: "Stage the configured exact SHA, require every candidate gate, snapshot client configs, activate both servers, post-probe, and roll back on failure. Requires the exact updater operation lock.",
      inputSchema: z.object({ ...updateMutationAuth }),
      idempotent: true,
      call: (input) => service.updateApply({
        workspaceHandle: input.workspace_handle,
        owner: input.owner,
        taskId: input.task_id,
        idempotencyKey: input.idempotency_key
      })
    },
    {
      name: "hp_mha_update_rollback",
      title: "Roll back to the previous known-good release",
      description: "Atomically switch the stable launcher back to the protected previous release. Requires the exact updater operation lock.",
      inputSchema: z.object({ ...updateMutationAuth }),
      destructive: true,
      idempotent: true,
      call: (input) => service.updateRollback({
        workspaceHandle: input.workspace_handle,
        owner: input.owner,
        taskId: input.task_id,
        idempotencyKey: input.idempotency_key
      })
    },
    {
      name: "hp_mha_update_channel",
      title: "Select stable or acknowledged preview updates",
      description: "Persist the update channel. Preview selection requires an explicit acknowledgement and the exact updater operation lock.",
      inputSchema: z.object({
        ...updateMutationAuth,
        channel: z.enum(["stable", "preview"]),
        acknowledge_preview: z.boolean().default(false)
      }),
      idempotent: true,
      call: (input) => service.updateChannel({
        workspaceHandle: input.workspace_handle,
        owner: input.owner,
        taskId: input.task_id,
        idempotencyKey: input.idempotency_key,
        channel: input.channel,
        acknowledgePreview: input.acknowledge_preview
      })
    },
    {
      name: "hp_mha_update_auto",
      title: "Configure per-user automatic refresh",
      description: "Install, update, or remove the bounded per-user scheduler with deterministic jitter, backoff, and an optional UTC maintenance window.",
      inputSchema: z.object({
        ...updateMutationAuth,
        enabled: z.boolean(),
        cadence_hours: z.number().int().min(1).max(168).default(6),
        jitter_minutes: z.number().int().min(0).max(240).default(45),
        maintenance_window_utc: z.object({
          startHour: z.number().int().min(0).max(23),
          endHour: z.number().int().min(0).max(23)
        }).nullable().default(null)
      }),
      idempotent: true,
      call: (input) => service.updateAuto({
        workspaceHandle: input.workspace_handle,
        owner: input.owner,
        taskId: input.task_id,
        idempotencyKey: input.idempotency_key,
        enabled: input.enabled,
        cadenceHours: input.cadence_hours,
        jitterMinutes: input.jitter_minutes,
        maintenanceWindowUtc: input.maintenance_window_utc
      })
    },
    {
      name: "hp_mha_update_cleanup",
      title: "Plan or apply contained release cleanup",
      description: "Remove only unprotected immutable releases under the managed root. Current and previous releases are always retained; dry-run is the default.",
      inputSchema: z.object({
        ...updateMutationAuth,
        retain: z.number().int().min(2).max(20).default(2),
        dry_run: z.boolean().default(true)
      }),
      destructive: true,
      idempotent: true,
      call: (input) => service.updateCleanup({
        workspaceHandle: input.workspace_handle,
        owner: input.owner,
        taskId: input.task_id,
        idempotencyKey: input.idempotency_key,
        retain: input.retain,
        dryRun: input.dry_run
      })
    }
  ];

  for (const definition of managerTools) {
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        outputSchema: resultSchema,
        annotations: {
          readOnlyHint: definition.readOnly === true,
          destructiveHint: definition.destructive === true,
          idempotentHint: definition.idempotent === true,
          openWorldHint: false
        },
        _meta: {
          "io.hermesproof/requiresWorkspaceHandle": true,
          "io.hermesproof/defaultDisabled": true,
          "io.hermesproof/leaseAware": true
        }
      },
      async (input) => executeTool(() => definition.call(input))
    );
  }

  server.registerTool(
    "hp_mha_serena_bind_workspace",
    {
      title: "Bind governed workspace",
      description: "Mint a short-lived signed handle for the server's configured workspace, current Git identity, principal, and policy. The handle is required by every coordination tool.",
      inputSchema: z.object({
        owner: z.string().trim().min(1).max(128),
        ttl_seconds: z.number().int().min(1).max(86_400).default(300)
      }),
      outputSchema: resultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      },
      _meta: {
        "io.hermesproof/protocolEra": era,
        "io.hermesproof/workspaceBound": true
      }
    },
    async ({ owner, ttl_seconds: ttlSeconds }) => executeTool(async () => {
      const binding = await service.bindWorkspace({
        owner,
        ttlMs: ttlSeconds * 1000
      });
      return {
        ok: true,
        workspace_handle: binding.token,
        handle_id: binding.handle_id,
        workspace_root: binding.workspace_root,
        issued_at_ms: binding.issued_at_ms,
        expires_at_ms: binding.expires_at_ms
      };
    })
  );

  server.registerTool(
    "hp_mha_serena_catalog",
    {
      title: "Explain Serena catalogue and active profiles",
      description: "Report the pinned 52-tool Serena catalogue, the 29-tool desktop default, the 23 optional/backend-specific tools, the 15-tool governed LSP surface, routes, and installed HermesProof context aliases.",
      inputSchema: z.object({
        workspace_handle: z.string().min(1),
        owner: z.string().trim().min(1).max(128)
      }),
      outputSchema: resultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      _meta: {
        "io.hermesproof/requiresWorkspaceHandle": true,
        "io.hermesproof/serenaPinned": true,
        "io.hermesproof/profileAware": true
      }
    },
    async (input) => executeTool(() => service.catalog({
      workspaceHandle: input.workspace_handle,
      owner: input.owner
    }))
  );

  server.registerTool(
    "hp_mha_serena_claim_and_lock",
    {
      title: "Claim task and lock exact files",
      description: "Atomically enter a governed task and acquire its exact file locks after verifying the signed workspace handle. A lock conflict rolls back the task claim.",
      inputSchema: z.object({
        workspace_handle: z.string().min(1),
        owner: z.string().trim().min(1).max(128),
        role: z.string().trim().min(1).max(64).default("agent"),
        task_id: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
        title: z.string().max(500).default(""),
        files: z.array(z.string().trim().min(1)).min(1).max(500),
        reason: z.string().max(2000).default(""),
        ttl_minutes: z.number().int().min(1).max(1_440).default(30)
      }),
      outputSchema: resultSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      _meta: {
        "io.hermesproof/requiresWorkspaceHandle": true,
        "io.hermesproof/lockAware": true
      }
    },
    async (input) => executeTool(() => service.claimAndLock({
      workspaceHandle: input.workspace_handle,
      owner: input.owner,
      role: input.role,
      taskId: input.task_id,
      title: input.title,
      files: input.files,
      reason: input.reason,
      ttlMinutes: input.ttl_minutes
    }))
  );

  server.registerTool(
    "hp_mha_serena_health",
    {
      title: "Verify pinned Serena semantic runtime",
      description: "Verify the signed workspace handle, pinned Serena commit, exact read-only MCP surface, TypeScript language-server readiness, and inactive mutation set.",
      inputSchema: z.object({
        workspace_handle: z.string().min(1),
        owner: z.string().trim().min(1).max(128)
      }),
      outputSchema: resultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      _meta: {
        "io.hermesproof/requiresWorkspaceHandle": true,
        "io.hermesproof/serenaPinned": true,
        "io.hermesproof/lockAware": true
      }
    },
    async (input) => executeTool(() => service.serenaHealth({
      workspaceHandle: input.workspace_handle,
      owner: input.owner
    }))
  );

  server.registerTool(
    "hp_mha_serena_semantic_inspect",
    {
      title: "Run governed Serena semantic analysis",
      description: "Call one selected read-only Serena tool in the signed workspace. Exact-file analysis returns a short-lived source-hash receipt required by guarded edits.",
      inputSchema: z.object({
        workspace_handle: z.string().min(1),
        owner: z.string().trim().min(1).max(128),
        tool: z.enum([...SERENA_SELECTED_LSP_TOOLS]),
        arguments: z.record(z.string(), z.unknown()).default({})
      }),
      outputSchema: resultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      },
      _meta: {
        "io.hermesproof/requiresWorkspaceHandle": true,
        "io.hermesproof/semanticReceipt": true,
        "io.hermesproof/serenaDirectMutation": false
      }
    },
    async (input) => executeTool(() => service.semanticInspect({
      workspaceHandle: input.workspace_handle,
      owner: input.owner,
      tool: input.tool,
      arguments: input.arguments
    }))
  );

  server.registerTool(
    "hp_mha_serena_guarded_create",
    {
      title: "Create one exact-lock governed file",
      description: "Create, never overwrite, one file only when the signed workspace handle, principal, task, and exact live file lock match. The exclusive write is rolled back if evidence cannot be recorded.",
      inputSchema: z.object({
        workspace_handle: z.string().min(1),
        owner: z.string().trim().min(1).max(128),
        task_id: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
        file: z.string().trim().min(1),
        text: z.string()
      }),
      outputSchema: resultSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      },
      _meta: {
        "io.hermesproof/requiresWorkspaceHandle": true,
        "io.hermesproof/requiresExactLock": true,
        "io.hermesproof/exclusiveCreate": true,
        "io.hermesproof/failClosed": true
      }
    },
    async (input) => executeTool(() => service.guardedCreate({
      workspaceHandle: input.workspace_handle,
      owner: input.owner,
      taskId: input.task_id,
      file: input.file,
      text: input.text
    }))
  );

  server.registerTool(
    "hp_mha_serena_guarded_replace",
    {
      title: "Apply receipt-gated exact-file edit",
      description: "Replace exactly one source occurrence only when the signed workspace handle, principal, task, exact live file lock, semantic receipt, and current source hash all match. The edit is rolled back if evidence cannot be recorded.",
      inputSchema: z.object({
        workspace_handle: z.string().min(1),
        owner: z.string().trim().min(1).max(128),
        task_id: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
        receipt_id: z.string().trim().min(1).max(128),
        file: z.string().trim().min(1),
        old_text: z.string().min(1),
        new_text: z.string()
      }),
      outputSchema: resultSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      },
      _meta: {
        "io.hermesproof/requiresWorkspaceHandle": true,
        "io.hermesproof/requiresExactLock": true,
        "io.hermesproof/requiresSemanticReceipt": true,
        "io.hermesproof/failClosed": true
      }
    },
    async (input) => executeTool(() => service.guardedReplace({
      workspaceHandle: input.workspace_handle,
      owner: input.owner,
      taskId: input.task_id,
      receiptId: input.receipt_id,
      file: input.file,
      oldText: input.old_text,
      newText: input.new_text
    }))
  );

  server.registerTool(
    "hp_mha_serena_status",
    {
      title: "Read workspace coordination status",
      description: "Read locks, tasks, handoffs, and evidence locations only after verifying the signed workspace handle and principal.",
      inputSchema: z.object({
        workspace_handle: z.string().min(1),
        owner: z.string().trim().min(1).max(128)
      }),
      outputSchema: resultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      _meta: {
        "io.hermesproof/requiresWorkspaceHandle": true
      }
    },
    async (input) => executeTool(() => service.status({
      workspaceHandle: input.workspace_handle,
      owner: input.owner
    }))
  );

  server.registerTool(
    "hp_mha_serena_release",
    {
      title: "Release exact files and task",
      description: "Release exact owned locks and then the task. The task remains claimed if any requested lock cannot be released.",
      inputSchema: z.object({
        workspace_handle: z.string().min(1),
        owner: z.string().trim().min(1).max(128),
        task_id: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
        files: z.array(z.string().trim().min(1)).min(1).max(500),
        note: z.string().max(2000).default("")
      }),
      outputSchema: resultSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      },
      _meta: {
        "io.hermesproof/requiresWorkspaceHandle": true,
        "io.hermesproof/lockAware": true
      }
    },
    async (input) => executeTool(() => service.release({
      workspaceHandle: input.workspace_handle,
      owner: input.owner,
      taskId: input.task_id,
      files: input.files,
      note: input.note
    }))
  );

  return server;
}

export async function main() {
  const workspaceRoot = process.env.HERMES_WORKSPACE_ROOT;
  if (!workspaceRoot) {
    throw new Error(
      "HERMES_WORKSPACE_ROOT is required; hp-mha-serena never falls back to an implicit workspace"
    );
  }
  const service = new HpMhaSerenaService({
    workspaceRoot,
    stateDirName: process.env.HERMES_STATE_DIR_NAME || undefined,
    updateManagerFactory: () => createProductionUpdateManager({ workspaceRoot })
  });
  await service.init();

  const handle = serveStdio(
    ({ era }) => buildHpMhaSerenaServer({ service, era }),
    {
      legacy: "serve",
      onerror: (error) => {
        process.stderr.write("[hp-mha-serena] " + error.message + "\n");
      }
    }
  );

  const close = async () => {
    await service.close();
    await handle.close();
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  return handle;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write("[hp-mha-serena] fatal: " + (error?.message ?? String(error)) + "\n");
    process.exitCode = 1;
  });
}
