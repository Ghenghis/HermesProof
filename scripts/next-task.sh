#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

node --input-type=module - "$@" <<'NODE'
import { spawn } from "node:child_process";
import path from "node:path";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--owner") out.owner = argv[++i];
    else if (arg === "--prefer-task-id") out.prefer_task_id = argv[++i];
    else if (arg === "--workspace") out.workspace = argv[++i];
    else if (arg === "--help" || arg === "-h") out.help = true;
  }
  return out;
}

class StdioClient {
  constructor(serverEntry, env) {
    this.proc = spawn(process.platform === "win32" ? "node.exe" : "node", [serverEntry], {
      env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.id = 0;
    this.buf = "";
    this.queue = [];
    this.stderr = "";
    this.proc.stdout.on("data", (chunk) => this.onData(chunk.toString()));
    this.proc.stderr.on("data", (chunk) => { this.stderr += chunk.toString(); });
  }
  onData(text) {
    this.buf += text;
    let idx;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const next = this.queue.shift();
      if (next) next.resolve(msg);
    }
  }
  request(method, params) {
    this.id += 1;
    return new Promise((resolve) => {
      this.queue.push({ resolve });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: this.id, method, params }) + "\n");
    });
  }
  async initialize() {
    const init = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "next-task", version: "0.5.0" }
    });
    if (!init?.result) throw new Error(`initialize failed: ${JSON.stringify(init)} stderr=${this.stderr.slice(-500)}`);
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");
  }
  async call(name, args) {
    const response = await this.request("tools/call", { name, arguments: args });
    const text = response?.result?.content?.[0]?.text;
    if (!text) throw new Error(`tool returned no text content: ${JSON.stringify(response)} stderr=${this.stderr.slice(-500)}`);
    return JSON.parse(text);
  }
  async close() {
    this.proc.stdin.end();
    await new Promise((resolve) => setTimeout(resolve, 50));
    this.proc.kill("SIGTERM");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.owner) {
    console.error("Usage: scripts/next-task.sh --owner <owner> [--prefer-task-id <task-id>] [--workspace <path>]");
    return args.help ? 0 : 2;
  }
  const serverEntry = path.resolve("src", "server.mjs");
  const env = { ...process.env };
  if (args.workspace) env.MCP_LOCK_WORKSPACE = path.resolve(args.workspace);
  const client = new StdioClient(serverEntry, env);
  try {
    await client.initialize();
    const picked = await client.call("hermes_pick_task", {
      owner: args.owner,
      ...(args.prefer_task_id ? { prefer_task_id: args.prefer_task_id } : {})
    });
    if (!picked.ok) {
      console.error(JSON.stringify(picked, null, 2));
      return 1;
    }
    console.log(JSON.stringify(picked, null, 2));
    return 0;
  } finally {
    await client.close();
  }
}

process.exit(await main());
NODE
