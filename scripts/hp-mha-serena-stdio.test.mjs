import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(repoRoot, "src", "hp-mha-serena", "server.mjs");

async function withWorkspace(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hp-mha-serena-stdio-"));
  await mkdir(path.join(root, "src"));
  await mkdir(path.join(root, ".serena"));
  await writeFile(
    path.join(root, "src", "api.mjs"),
    "export function api() { return \"old\"; }\n",
    "utf8"
  );
  await writeFile(
    path.join(root, ".serena", "project.yml"),
    [
      "project_name: HpMhaSerenaE2E",
      "language_servers:",
      "- typescript",
      "read_only: true",
      "excluded_tools:",
      "- activate_project",
      "- create_text_file",
      "- delete_memory",
      "- edit_memory",
      "- execute_shell_command",
      "- insert_after_symbol",
      "- insert_before_symbol",
      "- onboarding",
      "- rename_memory",
      "- rename_symbol",
      "- replace_content",
      "- replace_in_files",
      "- replace_symbol_body",
      "- safe_delete_symbol",
      "- write_memory",
      "included_optional_tools:",
      "- get_diagnostics_for_symbol",
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(root, ".serena", "hermesproof-context.yml"),
    [
      "description: HermesProof E2E semantic context",
      "prompt: Semantic analysis only.",
      "excluded_tools:",
      "- activate_project",
      "- create_text_file",
      "- delete_memory",
      "- edit_memory",
      "- execute_shell_command",
      "- insert_after_symbol",
      "- insert_before_symbol",
      "- onboarding",
      "- rename_memory",
      "- rename_symbol",
      "- replace_content",
      "- replace_in_files",
      "- replace_symbol_body",
      "- safe_delete_symbol",
      "- write_memory",
      "included_optional_tools:",
      "- get_diagnostics_for_symbol",
      "tool_description_overrides: {}",
      "single_project: false",
      "structured_tool_output: true",
      ""
    ].join("\n"),
    "utf8"
  );
  try {
    await fn(root);
  } finally {
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100
    });
  }
}

async function connectClient(workspaceRoot, versionNegotiation) {
  const client = new Client(
    { name: "hp-mha-serena-e2e", version: "1.0.0" },
    versionNegotiation ? { versionNegotiation } : undefined
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: workspaceRoot,
    env: {
      ...process.env,
      HERMES_WORKSPACE_ROOT: workspaceRoot,
      HERMES_STATE_DIR_NAME: ".hermes-test"
    },
    stderr: "pipe"
  });
  await client.connect(transport);
  return { client, transport };
}

async function exerciseCoordination(client, owner, taskId) {
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, [
    "hp_mha_serena_bind_workspace",
    "hp_mha_serena_claim_and_lock",
    "hp_mha_serena_guarded_replace",
    "hp_mha_serena_health",
    "hp_mha_serena_release",
    "hp_mha_serena_semantic_inspect",
    "hp_mha_serena_status"
  ]);

  const binding = await client.callTool({
    name: "hp_mha_serena_bind_workspace",
    arguments: { owner, ttl_seconds: 60 }
  });
  assert.equal(binding.isError, undefined);
  assert.equal(binding.structuredContent.ok, true);
  assert.equal(typeof binding.structuredContent.workspace_handle, "string");

  const locked = await client.callTool({
    name: "hp_mha_serena_claim_and_lock",
    arguments: {
      workspace_handle: binding.structuredContent.workspace_handle,
      owner,
      role: "agent",
      task_id: taskId,
      title: "Prove dual-era coordination",
      files: ["src/api.mjs"],
      reason: "MCP stdio E2E"
    }
  });
  assert.equal(locked.isError, undefined);
  assert.equal(locked.structuredContent.ok, true);
  assert.equal(locked.structuredContent.status, "locked");

  const health = await client.callTool({
    name: "hp_mha_serena_health",
    arguments: {
      workspace_handle: binding.structuredContent.workspace_handle,
      owner
    }
  });
  assert.equal(health.isError, undefined);
  assert.equal(health.structuredContent.ok, true);
  assert.equal(health.structuredContent.advertised_tool_count, 15);
  assert.equal(health.structuredContent.mutation_tools_active.length, 0);

  const inspected = await client.callTool({
    name: "hp_mha_serena_semantic_inspect",
    arguments: {
      workspace_handle: binding.structuredContent.workspace_handle,
      owner,
      tool: "find_symbol",
      arguments: {
        name_path_pattern: "api",
        relative_path: "src/api.mjs",
        include_body: true
      }
    }
  });
  assert.equal(inspected.isError, undefined);
  assert.equal(inspected.structuredContent.ok, true);
  assert.equal(inspected.structuredContent.receipt.file, "src/api.mjs");

  const edited = await client.callTool({
    name: "hp_mha_serena_guarded_replace",
    arguments: {
      workspace_handle: binding.structuredContent.workspace_handle,
      owner,
      task_id: taskId,
      receipt_id: inspected.structuredContent.receipt.id,
      file: "src/api.mjs",
      old_text: "\"old\"",
      new_text: "\"" + owner + "\""
    }
  });
  assert.equal(edited.isError, undefined);
  assert.equal(edited.structuredContent.ok, true);
  assert.equal(edited.structuredContent.status, "edited");

  const status = await client.callTool({
    name: "hp_mha_serena_status",
    arguments: {
      workspace_handle: binding.structuredContent.workspace_handle,
      owner
    }
  });
  assert.equal(status.isError, undefined);
  assert.equal(status.structuredContent.ok, true);
  assert.equal(status.structuredContent.locks.length, 1);

  const invalid = await client.callTool({
    name: "hp_mha_serena_status",
    arguments: {
      workspace_handle: binding.structuredContent.workspace_handle + "tampered",
      owner
    }
  });
  assert.equal(invalid.isError, true);
  assert.equal(invalid.structuredContent.ok, false);
  assert.equal(invalid.structuredContent.code, "INVALID_SIGNATURE");

  const released = await client.callTool({
    name: "hp_mha_serena_release",
    arguments: {
      workspace_handle: binding.structuredContent.workspace_handle,
      owner,
      task_id: taskId,
      files: ["src/api.mjs"],
      note: "E2E complete"
    }
  });
  assert.equal(released.isError, undefined);
  assert.equal(released.structuredContent.ok, true);
}

test("hp-mha-serena stdio serves both modern 2026 and legacy MCP eras", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const modern = await connectClient(workspaceRoot, {
      mode: { pin: "2026-07-28" }
    });
    try {
      assert.equal(modern.client.getProtocolEra(), "modern");
      await exerciseCoordination(modern.client, "modern-agent", "modern-e2e");
    } finally {
      await modern.client.close();
    }
    assert.match(
      await readFile(path.join(workspaceRoot, "src", "api.mjs"), "utf8"),
      /"modern-agent"/u
    );
    await writeFile(
      path.join(workspaceRoot, "src", "api.mjs"),
      "export function api() { return \"old\"; }\n",
      "utf8"
    );

    const legacy = await connectClient(workspaceRoot);
    try {
      assert.equal(legacy.client.getProtocolEra(), "legacy");
      await exerciseCoordination(legacy.client, "legacy-agent", "legacy-e2e");
    } finally {
      await legacy.client.close();
    }
    assert.match(
      await readFile(path.join(workspaceRoot, "src", "api.mjs"), "utf8"),
      /"legacy-agent"/u
    );
  });
});
