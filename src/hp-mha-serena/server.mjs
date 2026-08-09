#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod4";

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
    stateDirName: process.env.HERMES_STATE_DIR_NAME || undefined
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
