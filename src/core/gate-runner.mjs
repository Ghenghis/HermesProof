import { spawn } from "node:child_process";
import path from "node:path";
import { appendJsonLine, ensureDir, safeWorkspaceRoot, statePaths, utcNow, writeJsonAtomic } from "./fs-utils.mjs";

export const DEFAULT_GATES = {
  "git-status": {
    command: "git",
    args: ["status", "--short"],
    timeout_ms: 20_000,
    description: "Show changed files without modifying the repo."
  },
  "git-branch": {
    command: "git",
    args: ["branch", "--show-current"],
    timeout_ms: 20_000,
    description: "Show current branch."
  },
  "git-diff-check": {
    command: "git",
    args: ["diff", "--check"],
    timeout_ms: 30_000,
    description: "Detect whitespace and merge-conflict markers in working tree without modifying anything."
  },
  "git-diff-staged": {
    command: "git",
    args: ["diff", "--cached", "--stat"],
    timeout_ms: 30_000,
    description: "Show summary of staged changes."
  },
  "git-log-recent": {
    command: "git",
    args: ["log", "-n", "10", "--oneline", "--decorate"],
    timeout_ms: 20_000,
    description: "Last 10 commits, one line each, with refs."
  },
  "npm-test": {
    command: "npm",
    args: ["test"],
    timeout_ms: 120_000,
    description: "Run project test script."
  },
  "npm-build": {
    command: "npm",
    args: ["run", "build"],
    timeout_ms: 180_000,
    description: "Run project build script."
  },
  "npm-lint": {
    command: "npm",
    args: ["run", "lint"],
    timeout_ms: 120_000,
    description: "Run project lint script."
  },
  "npm-typecheck": {
    command: "npm",
    args: ["run", "typecheck"],
    timeout_ms: 120_000,
    description: "Run project typecheck script."
  },
  "npm-audit": {
    command: "npm",
    args: ["audit", "--audit-level=high"],
    timeout_ms: 60_000,
    description: "Read-only npm audit at high severity threshold."
  },
  "playwright": {
    command: "npx",
    args: ["playwright", "test"],
    timeout_ms: 240_000,
    description: "Run Playwright tests."
  }
};

export class GateRunner {
  constructor({ workspaceRoot } = {}) {
    this.workspaceRoot = safeWorkspaceRoot(workspaceRoot);
    this.paths = statePaths(this.workspaceRoot);
  }

  listGates() {
    return Object.entries(DEFAULT_GATES).map(([id, gate]) => ({ id, ...gate }));
  }

  async runGate({ owner, gateId, cwd = ".", env = {} }) {
    if (!owner || typeof owner !== "string") throw new Error("owner is required");
    const gate = DEFAULT_GATES[gateId];
    if (!gate) {
      return {
        ok: false,
        status: "rejected",
        message: `Gate '${gateId}' is not in the allowlist.`,
        allowed_gates: this.listGates().map((g) => g.id)
      };
    }
    const requestedCwd = path.resolve(this.workspaceRoot, cwd);
    const rel = path.relative(this.workspaceRoot, requestedCwd);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error("cwd escapes workspace");
    }

    const started = Date.now();
    const result = await runProcess({
      command: gate.command,
      args: gate.args,
      cwd: requestedCwd,
      timeoutMs: gate.timeout_ms,
      env: { ...process.env, ...stringEnv(env) }
    });

    const report = {
      id: `gate_${gateId}_${Date.now()}`,
      ts_utc: utcNow(),
      owner,
      gate_id: gateId,
      command: gate.command,
      args: gate.args,
      cwd: requestedCwd,
      duration_ms: Date.now() - started,
      exit_code: result.exitCode,
      timed_out: result.timedOut,
      ok: result.exitCode === 0 && !result.timedOut,
      stdout_tail: result.stdout.slice(-6000),
      stderr_tail: result.stderr.slice(-6000)
    };

    await ensureDir(this.paths.gatesDir);
    await writeJsonAtomic(path.join(this.paths.gatesDir, `${report.id}.json`), report);
    await appendJsonLine(this.paths.evidenceFile, {
      id: report.id,
      ts_utc: report.ts_utc,
      owner,
      kind: "gate",
      summary: `${gateId}: ${report.ok ? "PASS" : "FAIL"}`,
      data: {
        exit_code: report.exit_code,
        timed_out: report.timed_out,
        duration_ms: report.duration_ms,
        cwd: report.cwd
      }
    });

    return {
      ok: report.ok,
      status: report.ok ? "pass" : "fail",
      report
    };
  }
}

function stringEnv(env) {
  const out = {};
  for (const [k, v] of Object.entries(env || {})) {
    if (typeof k === "string" && /^[A-Z0-9_]+$/i.test(k)) out[k] = String(v);
  }
  return out;
}

// On Windows, npm / npx / yarn / pnpm are .cmd shims. Resolve them explicitly
// so we can spawn with shell:false (avoiding Node 25's DEP0190 warning about
// shell:true + args, and removing any shell-injection surface even though our
// args are hardcoded in DEFAULT_GATES).
const WIN_CMD_SHIMS = new Set(["npm", "npx", "yarn", "pnpm"]);
function resolveCommandForPlatform(command) {
  if (process.platform !== "win32") return command;
  if (WIN_CMD_SHIMS.has(command)) return `${command}.cmd`;
  return command;
}

function runProcess({ command, args, cwd, timeoutMs, env }) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const resolved = resolveCommandForPlatform(command);
    let child;
    try {
      // shell:false — args are passed verbatim to the OS. DEFAULT_GATES literals
      // only; never accept user-controlled command/args here.
      child = spawn(resolved, args, { cwd, env, shell: false });
    } catch (err) {
      resolve({
        exitCode: 127,
        timedOut: false,
        stdout: "",
        stderr: `Failed to spawn '${resolved}': ${err.message}. Is it installed and on PATH?`
      });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref?.();
    }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (err) => {
      clearTimeout(timer);
      const hint = err.code === "ENOENT"
        ? ` Hint: '${command}' was not found on PATH. Install it or run the gate from a shell where it is available.`
        : "";
      resolve({ exitCode: 127, timedOut, stdout, stderr: stderr + `\n${err.message}${hint}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, timedOut, stdout, stderr });
    });
  });
}
