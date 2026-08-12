#!/usr/bin/env node
/**
 * Standalone CLI wrapper around HermesLockManager.doctor().
 * Useful for verifying environment without launching the MCP transport.
 *
 * Usage:
 *   node scripts/doctor.mjs [--workspace <path>] [--state-dir <name>]
 *
 * Exits with code 1 if any blocking findings are reported.
 */
import { HermesLockManager } from "../src/core/lock-manager.mjs";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--workspace" || a === "-w") out.workspace = argv[++i];
    else if (a === "--state-dir") out.stateDirName = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(
    `MCP Lock Orchestrator doctor

Usage:
  node scripts/doctor.mjs [--workspace <path>] [--state-dir <name>]

Returns non-zero exit code if any blocking findings are reported.`
  );
  process.exit(0);
}

const workspace =
  args.workspace ||
  process.env.MCP_LOCK_WORKSPACE ||
  process.env.HERMES3D_WORKSPACE ||
  process.cwd();
const stateDirName = args.stateDirName || process.env.MCP_LOCK_STATE_DIR || undefined;

const manager = new HermesLockManager({ workspaceRoot: workspace, stateDirName });
const report = await manager.doctor();

console.log(JSON.stringify(report, null, 2));

const blocking = report.findings.filter((f) => f.level === "error");
if (blocking.length > 0) {
  console.error(`\n${blocking.length} blocking finding(s).`);
  process.exit(1);
}
process.exit(0);
