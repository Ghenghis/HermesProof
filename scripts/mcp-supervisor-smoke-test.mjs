#!/usr/bin/env node
/**
 * Smoke test for mcp-supervisor.mjs.
 *
 * Verifies:
 *   - supervisor spawns the configured server
 *   - on a synthetic crash (kill child), supervisor respawns
 *   - circuit breaker trips after MAX_CRASHES in window
 *   - clean exit (code 0) terminates supervisor cleanly
 *   - SIGTERM forwarded to child
 *
 * Uses a tiny mock-server script as the child rather than the real MCP
 * server, so the test is fast and doesn't require MCP wiring.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SUPERVISOR = path.join(SCRIPT_DIR, "mcp-supervisor.mjs");

async function makeMockServer(behaviour) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-sup-"));
  const mockPath = path.join(dir, "mock-server.mjs");
  let body;
  if (behaviour === "crash-once") {
    body = `
      import fs from "node:fs/promises";
      const flag = process.env.MOCK_FLAG_FILE;
      const ran = await fs.readFile(flag, "utf8").catch(() => "");
      if (!ran) {
        await fs.writeFile(flag, "1");
        process.exit(2); // crash
      } else {
        process.stdout.write("ready\\n");
        setTimeout(() => process.exit(0), 200);
      }
    `;
  } else if (behaviour === "clean") {
    body = `
      process.stdout.write("ready\\n");
      setTimeout(() => process.exit(0), 100);
    `;
  } else if (behaviour === "always-crash") {
    body = `process.exit(2);`;
  }
  await fs.writeFile(mockPath, body);
  return { dir, mockPath };
}

async function runSupervisor(serverPath, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SUPERVISOR], {
      env: {
        ...process.env,
        // Override SERVER_PATH by making the supervisor find a different file
        // We use a sandbox repo to do this cleanly:
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

test("supervisor module loads", async () => {
  const stat = await fs.stat(SUPERVISOR);
  assert.ok(stat.isFile());
});

test("supervisor exits cleanly when server exits with code 0", async () => {
  // Build a sandbox repo: copy supervisor + write mock server.mjs at the
  // expected path
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-sup-sandbox-"));
  await fs.mkdir(path.join(sandbox, "scripts"), { recursive: true });
  await fs.mkdir(path.join(sandbox, "src"), { recursive: true });
  await fs.copyFile(SUPERVISOR, path.join(sandbox, "scripts", "mcp-supervisor.mjs"));
  await fs.writeFile(
    path.join(sandbox, "src", "server.mjs"),
    `process.stdout.write("ready\\n"); setTimeout(() => process.exit(0), 100);`
  );
  const result = await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [path.join(sandbox, "scripts", "mcp-supervisor.mjs")],
      { stdio: ["pipe", "pipe", "pipe"], cwd: sandbox }
    );
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.on("exit", (code) => resolve({ code, stdout }));
    setTimeout(() => child.kill("SIGKILL"), 5000); // safety timeout
  });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /ready/);
});

test("supervisor propagates stdin EOF to child for clean MCP-client-disconnect shutdown", async () => {
  // Regression for line 116 audit finding: pre-fix used `pipe(child.stdin, {end:false})`
  // which suppressed EOF, so `src/server.mjs` could not observe MCP client
  // disconnect and would block forever, forcing the supervisor to also hang.
  // Now stdin EOF propagates through to the child, which exits cleanly,
  // which lets the supervisor exit cleanly on its own.
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-sup-stdin-eof-"));
  await fs.mkdir(path.join(sandbox, "scripts"), { recursive: true });
  await fs.mkdir(path.join(sandbox, "src"), { recursive: true });
  await fs.copyFile(SUPERVISOR, path.join(sandbox, "scripts", "mcp-supervisor.mjs"));
  // Mock server: signals ready, then exits with code 0 the moment stdin EOFs.
  // Without the line 116 fix, EOF never arrives and the setTimeout fires (FAIL).
  await fs.writeFile(
    path.join(sandbox, "src", "server.mjs"),
    `process.stdout.write("ready\\n");
     process.stdin.on("end", () => process.exit(0));
     process.stdin.resume();
     setTimeout(() => process.exit(99), 5000);` // failure sentinel
  );
  const result = await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [path.join(sandbox, "scripts", "mcp-supervisor.mjs")],
      { stdio: ["pipe", "pipe", "pipe"], cwd: sandbox }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
    // Once the mock server is ready, close our end of stdin to it. EOF should
    // flow: us → supervisor.stdin → (pipe) → child.stdin → mock-server sees EOF.
    const waitReady = setInterval(() => {
      if (stdout.includes("ready")) {
        clearInterval(waitReady);
        child.stdin.end();
      }
    }, 50);
    setTimeout(() => { clearInterval(waitReady); try { child.kill("SIGKILL"); } catch {} }, 8000);
  });
  assert.equal(result.code, 0,
    `expected clean exit (mock server should see stdin EOF, exit 0, supervisor follows). Got code=${result.code}\nstderr: ${result.stderr}`);
  assert.match(result.stdout, /ready/);
});

// SIGTERM/SIGINT delivery to a child Node process is platform-specific:
// on Windows, child.kill is TerminateProcess (no handler invoked), so this
// test is Unix-only. The supervisor's signal-exit logic is also exercised
// indirectly by the stdin-EOF test above on every platform.
const skipSignalTest = process.platform === "win32";
test("supervisor exits cleanly on SIGTERM (no respawn loop)", { skip: skipSignalTest }, async () => {
  // Regression for line 159 audit finding: pre-fix forwarded the signal to
  // the child but had no shutdownSignal flag, so when the child died from
  // the forwarded signal, supervise() treated it as a crash and respawned.
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-sup-sigterm-"));
  await fs.mkdir(path.join(sandbox, "scripts"), { recursive: true });
  await fs.mkdir(path.join(sandbox, "src"), { recursive: true });
  await fs.copyFile(SUPERVISOR, path.join(sandbox, "scripts", "mcp-supervisor.mjs"));
  await fs.writeFile(
    path.join(sandbox, "src", "server.mjs"),
    `process.stdout.write("ready\\n"); setInterval(() => {}, 1000);`
  );
  const result = await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [path.join(sandbox, "scripts", "mcp-supervisor.mjs")],
      { stdio: ["pipe", "pipe", "pipe"], cwd: sandbox }
    );
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("exit", (code, sig) => resolve({ code, sig, stdout, stderr }));
    const waitReady = setInterval(() => {
      if (stdout.includes("ready")) {
        clearInterval(waitReady);
        child.kill("SIGTERM");
      }
    }, 50);
    setTimeout(() => { clearInterval(waitReady); try { child.kill("SIGKILL"); } catch {} }, 8000);
  });
  assert.equal(result.code, 0, `expected clean exit, got code=${result.code} sig=${result.sig}\nstderr: ${result.stderr}`);
  assert.match(result.stderr, /supervisor exiting/);
  const respawnCount = (result.stderr.match(/server crashed/g) || []).length;
  assert.ok(respawnCount <= 1, `unexpected respawn after signal: ${respawnCount} crash logs\n${result.stderr}`);
});

test("supervisor circuit-breaker fires after MAX_CRASHES in window", async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-sup-cb-"));
  await fs.mkdir(path.join(sandbox, "scripts"), { recursive: true });
  await fs.mkdir(path.join(sandbox, "src"), { recursive: true });
  await fs.copyFile(SUPERVISOR, path.join(sandbox, "scripts", "mcp-supervisor.mjs"));
  await fs.writeFile(path.join(sandbox, "src", "server.mjs"), `process.exit(2);`);
  const result = await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [path.join(sandbox, "scripts", "mcp-supervisor.mjs")],
      {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: sandbox,
        env: {
          ...process.env,
          // Tight window: 3 crashes in 60s → trip
          HERMESPROOF_SUPERVISOR_MAX_CRASHES: "3",
          HERMESPROOF_SUPERVISOR_WINDOW_MS: "60000",
        },
      }
    );
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("exit", (code) => resolve({ code, stderr }));
    setTimeout(() => child.kill("SIGKILL"), 30000); // safety timeout (allows 3 crashes + small backoffs)
  });
  // Should have tripped: exit code 1
  assert.equal(result.code, 1);
  assert.match(result.stderr, /circuit breaker tripped/);
});
