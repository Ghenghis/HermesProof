#!/usr/bin/env node
/**
 * mcp-supervisor.mjs — auto-reconnecting wrapper for the HermesProof MCP server.
 *
 * Spawns `node src/server.mjs` and respawns it on crash. Implements:
 *   - Exponential backoff (1s → 2s → 4s → 8s, capped at 30s)
 *   - Crash counter + circuit-breaker (10 crashes in 5 min → exit 1, surface
 *     to the client so it knows something is structurally broken)
 *   - SIGTERM / SIGINT propagation (clean shutdown when supervisor itself
 *     receives a signal)
 *   - stdin/stdout/stderr passthrough to the parent (the MCP client speaks
 *     stdio; the supervisor is transparent to the client)
 *   - Health log to .hermes3d_orchestrator/supervisor.log (rotated at 1MB)
 *
 * Why a supervisor:
 *   The MCP stdio transport doesn't have a built-in reconnect protocol; if
 *   the server process dies, the client sees stdio close and stops calling.
 *   Wrapping with a supervisor that respawns the child gives the client a
 *   continuous stdio stream that survives server crashes, panics, or OOMs.
 *
 * Usage:
 *   In your MCP client config, replace:
 *     "command": "node", "args": ["src/server.mjs"]
 *   with:
 *     "command": "node", "args": ["scripts/mcp-supervisor.mjs"]
 *
 *   Optional env:
 *     HERMESPROOF_SUPERVISOR_DISABLED=1  → run server directly (testing)
 *     HERMESPROOF_SUPERVISOR_MAX_CRASHES=N (default 10)
 *     HERMESPROOF_SUPERVISOR_WINDOW_MS=N  (default 300000 / 5min)
 *     HERMESPROOF_SUPERVISOR_LOG=path     (default .hermes3d_orchestrator/supervisor.log)
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(SCRIPT_DIR);
const SERVER_PATH = path.join(REPO_ROOT, "src", "server.mjs");

const MAX_CRASHES = Number(process.env.HERMESPROOF_SUPERVISOR_MAX_CRASHES) || 10;
const WINDOW_MS = Number(process.env.HERMESPROOF_SUPERVISOR_WINDOW_MS) || 5 * 60 * 1000;
const BACKOFF_INITIAL_MS = 1000;
const BACKOFF_MAX_MS = 30000;

const workspaceRoot =
  process.env.MCP_LOCK_WORKSPACE || process.env.HERMES3D_WORKSPACE || process.cwd();
const stateDir = path.join(
  workspaceRoot,
  process.env.MCP_LOCK_STATE_DIR || ".hermes3d_orchestrator"
);
const logPath =
  process.env.HERMESPROOF_SUPERVISOR_LOG || path.join(stateDir, "supervisor.log");

const crashTimestamps = [];

async function log(msg) {
  const line = `${new Date().toISOString()} [supervisor] ${msg}\n`;
  // Always emit to stderr so the parent / MCP client sees it
  process.stderr.write(line);
  try {
    await fs.mkdir(stateDir, { recursive: true });
    // Rotate if >1MB
    try {
      const stat = await fs.stat(logPath);
      if (stat.size > 1024 * 1024) {
        await fs.rename(logPath, logPath + ".old").catch(() => {});
      }
    } catch {
      // file doesn't exist yet — fine
    }
    await fs.appendFile(logPath, line);
  } catch {
    // logging is best-effort; never fail the supervisor over a log write
  }
}

function purgeOldCrashes() {
  const cutoff = Date.now() - WINDOW_MS;
  while (crashTimestamps.length > 0 && crashTimestamps[0] < cutoff) {
    crashTimestamps.shift();
  }
}

function backoffMs(crashCount) {
  // 1s, 2s, 4s, 8s, 16s, 30s (cap)
  return Math.min(BACKOFF_INITIAL_MS * Math.pow(2, crashCount - 1), BACKOFF_MAX_MS);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Track the currently-active child so the single top-level signal handler
// can forward to whichever child is alive at signal time. Replaces the
// per-spawn `process.once` handlers from the original implementation, which
// accumulated across reconnects and held references to dead child objects.
let activeChild = null;

async function spawnServer() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SERVER_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    activeChild = child;

    // end:false — when the child exits, do NOT close the supervisor's own
    // stdio. Otherwise the next respawn has nowhere to write, and the MCP
    // client sees a permanently dead stream. The audit on PR #33 flagged
    // the default end:true as the cause of "supervisor reconnects but
    // client still sees disconnect".
    process.stdin.pipe(child.stdin, { end: false });
    child.stdout.pipe(process.stdout, { end: false });
    child.stderr.pipe(process.stderr, { end: false });

    let exited = false;

    child.on("exit", (code, signal) => {
      if (exited) return;
      exited = true;
      try {
        process.stdin.unpipe(child.stdin);
      } catch {}
      try {
        child.stdout.unpipe(process.stdout);
      } catch {}
      try {
        child.stderr.unpipe(process.stderr);
      } catch {}
      if (activeChild === child) activeChild = null;
      resolve({ code, signal });
    });

    child.on("error", (err) => {
      if (exited) return;
      exited = true;
      if (activeChild === child) activeChild = null;
      log(`spawn error: ${err.message}`);
      resolve({ code: 1, signal: null, error: err.message });
    });
  });
}

// Single top-level signal handler. Forwards to whichever child is currently
// active at signal time. Replaces the per-spawn `process.once` handlers from
// the original (each spawn iteration leaked a stale handler).
const forwardSignal = (sig) => {
  if (activeChild) {
    try {
      activeChild.kill(sig);
    } catch {}
  }
};
process.on("SIGTERM", () => forwardSignal("SIGTERM"));
process.on("SIGINT", () => forwardSignal("SIGINT"));

async function supervise() {
  if (process.env.HERMESPROOF_SUPERVISOR_DISABLED === "1") {
    await log("supervisor disabled via HERMESPROOF_SUPERVISOR_DISABLED=1; spawning server in-process is not supported, please run `node src/server.mjs` directly");
    process.exit(0);
  }

  if (!fsSync.existsSync(SERVER_PATH)) {
    await log(`server not found at ${SERVER_PATH}; cannot supervise`);
    process.exit(1);
  }

  await log(`starting; server=${SERVER_PATH} max_crashes=${MAX_CRASHES} window_ms=${WINDOW_MS}`);

  while (true) {
    const result = await spawnServer();

    if (result.code === 0 && result.signal === null) {
      // Clean exit; supervisor follows
      await log("server exited cleanly (code 0); supervisor exiting");
      process.exit(0);
    }

    crashTimestamps.push(Date.now());
    purgeOldCrashes();
    const crashesInWindow = crashTimestamps.length;

    await log(
      `server crashed (code=${result.code} signal=${result.signal}); ` +
        `crashes_in_window=${crashesInWindow}/${MAX_CRASHES}`
    );

    if (crashesInWindow >= MAX_CRASHES) {
      await log(
        `circuit breaker tripped: ${crashesInWindow} crashes in ${WINDOW_MS}ms; surfacing to client`
      );
      process.exit(1);
    }

    const wait = backoffMs(crashesInWindow);
    await log(`backing off ${wait}ms before respawn`);
    await delay(wait);
  }
}

supervise().catch(async (err) => {
  await log(`supervisor uncaught error: ${err?.stack || err?.message || err}`);
  process.exit(1);
});
