#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const SERVER_ENTRIES = Object.freeze({
  "hermes3d-locks": ["src", "server.mjs"],
  "hp-mha-serena": ["src", "hp-mha-serena", "server.mjs"]
});

export async function probeCandidateServer({
  candidateRoot,
  workspaceRoot,
  server,
  timeoutMs = 90_000
} = {}) {
  if (!SERVER_ENTRIES[server]) throw new Error("server is not allowlisted");
  if (!path.isAbsolute(candidateRoot || "") || !path.isAbsolute(workspaceRoot || "")) {
    throw new Error("candidateRoot and workspaceRoot must be absolute");
  }
  const entry = path.join(path.resolve(candidateRoot), ...SERVER_ENTRIES[server]);
  const stat = await fs.lstat(entry);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("candidate server entry is invalid");
  const probeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hermesproof-candidate-probe-"));
  const probeWorkspace = path.join(probeRoot, "workspace");
  await fs.mkdir(probeWorkspace);
  const client = new Client({ name: "hermesproof-updater-probe", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    cwd: path.resolve(candidateRoot),
    env: {
      ...process.env,
      MCP_LOCK_WORKSPACE: probeWorkspace,
      HERMES_WORKSPACE_ROOT: probeWorkspace,
      HERMES_STATE_DIR_NAME: ".hermesproof-updater-probe",
      HERMESPROOF_MANAGED_ROOT: path.join(probeRoot, "managed"),
      SERENA_HOME: path.join(probeRoot, "serena")
    },
    stderr: "pipe"
  });
  let timer;
  try {
    await Promise.race([
      client.connect(transport),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("candidate MCP handshake timed out")), timeoutMs);
        timer.unref?.();
      })
    ]);
    const listed = await client.listTools();
    const tools = listed.tools.map((tool) => tool.name).sort();
    if (tools.length === 0) throw new Error("candidate MCP registry is empty");
    return {
      ok: true,
      server,
      toolCount: tools.length,
      tools
    };
  } finally {
    clearTimeout(timer);
    await client.close().catch(() => {});
    await fs.rm(probeRoot, { recursive: true, force: true });
  }
}

function argumentsOf(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--candidate") output.candidateRoot = argv[++index];
    else if (value === "--workspace") output.workspaceRoot = argv[++index];
    else if (value === "--server") output.server = argv[++index];
    else throw new Error("unknown probe option: " + value);
  }
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  probeCandidateServer(argumentsOf(process.argv.slice(2))).then((result) => {
    process.stdout.write(JSON.stringify(result) + "\n");
  }).catch((error) => {
    process.stderr.write("Candidate probe failed: " + error.message + "\n");
    process.exitCode = 1;
  });
}
