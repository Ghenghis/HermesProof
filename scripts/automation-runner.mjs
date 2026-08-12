#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { HpMhaSerenaService } from "../src/hp-mha-serena/service.mjs";
import { verifyAutomationExecutionAuthorization } from "../src/core/automation-manager.mjs";

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const out = { workspace: "", job: "" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--workspace") out.workspace = argv[++i] || "";
    else if (argv[i] === "--job") out.job = argv[++i] || "";
    else throw new Error("unknown automation argument: " + argv[i]);
  }
  if (!out.workspace || !out.job) throw new Error("--workspace and --job are required");
  if (!/^[a-z0-9][a-z0-9._-]*$/iu.test(out.job)) throw new Error("invalid automation job id");
  return out;
}

async function runNode(script, args) {
  const result = await execFileAsync(process.execPath, [script, ...args], {
    cwd: workspaceRoot,
    windowsHide: true,
    timeout: 600_000,
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

const args = parseArgs(process.argv.slice(2));
const workspaceRoot = await fs.realpath(path.resolve(args.workspace));
const packageJson = JSON.parse(await fs.readFile(path.join(workspaceRoot, "package.json"), "utf8"));
if (packageJson.name !== "hermesproof") throw new Error("automation workspace is not HermesProof");
await verifyAutomationExecutionAuthorization({ workspaceRoot, jobId: args.job });

if (args.job === "deep-doctor") {
  await runNode(path.join(workspaceRoot, "scripts", "doctor.mjs"), ["--workspace", workspaceRoot]);
} else if (args.job === "completion-pulse") {
  await runNode(path.join(workspaceRoot, "examples", "hp-mha", "load-card.mjs"), ["--all"]);
} else if (args.job === "disable-unused-mcp") {
  const service = await new HpMhaSerenaService({ workspaceRoot }).init();
  const result = await service.runtimeManager.disableUnused();
  process.stdout.write(JSON.stringify({ schema: "hermesproof.automation-run.v1", job_id: args.job, ...result }) + "\n");
} else {
  throw new Error("automation job is not allowlisted: " + args.job);
}
