#!/usr/bin/env node
/**
 * Truth-gate harness — single-command attestation runner.
 *
 * Runs every safety- and functionality-relevant check, captures structured
 * evidence, and writes:
 *   - PROOF/latest.json         (machine-readable)
 *   - PROOF_E2E_REPORT.md       (human-readable summary at repo root)
 *
 * Exits non-zero if any required gate fails.
 *
 * Each gate writes a record:
 *   { id, level: "required" | "warn", ok: true|false, duration_ms, evidence, details? }
 *
 * Usage:
 *   node scripts/truth-gates.mjs [--workspace G:\\Github\\Hermes3D]
 *
 * Env:
 *   TRUTH_GATE_HERMES3D_WORKSPACE   (override --workspace)
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { HermesLockManager } from "../src/core/lock-manager.mjs";
import { ensureEventDirs } from "./generate-review-packet.mjs";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

function parseArgs(argv) {
  const out = { skip: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--workspace" || a === "-w") out.workspace = argv[++i];
    else if (a === "--skip") {
      const list = (argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
      for (const s of list) out.skip.add(s);
    } else if (a === "--ci") out.ci = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Usage: node scripts/truth-gates.mjs [options]

Options:
  --workspace <path>   Hermes3D-style workspace to validate (default: G:\\Github\\Hermes3D
                       on Windows, or current dir).
  --skip <ids>         Comma-separated gate ids to skip (recorded as "skipped" in proof).
  --ci                 Skip local-machine gates (clients.config_presence,
                       clients.claude_code_live, doctor.hermes3d, workspace.integrity).
                       Equivalent to:
                         --skip clients.config_presence,clients.claude_code_live,
                                doctor.hermes3d,workspace.integrity
  --help               Show this help.

Outputs:
  PROOF/latest.json        machine-readable evidence
  PROOF_E2E_REPORT.md      human-readable summary at repo root

Exit code 0 = all required (non-skipped) gates pass, non-zero otherwise.`);
  process.exit(0);
}
if (args.ci) {
  for (const g of [
    "clients.config_presence",
    "clients.claude_code_live",
    "doctor.hermes3d",
    "workspace.integrity"
  ]) {
    args.skip.add(g);
  }
}
const skip = args.skip;
const isWindows = process.platform === "win32";
const defaultWorkspace = isWindows ? "G:\\Github\\Hermes3D" : process.cwd();
const hermes3dWorkspace = path.resolve(
  args.workspace || process.env.TRUTH_GATE_HERMES3D_WORKSPACE || defaultWorkspace
);

const runStart = Date.now();
const runIso = new Date().toISOString();
const runId = `truth_${runIso.replace(/[:.]/g, "-")}`;
const gates = [];

function record(id, level, ok, evidence = {}, details = "", durationMs = 0) {
  gates.push({ id, level, ok, duration_ms: durationMs, evidence, details });
  const tag = level === "skipped" ? "SKIP" : ok ? "PASS" : level === "required" ? "FAIL" : "WARN";
  console.log(`[${tag}] ${id}${details ? `  -- ${details}` : ""}`);
}

function shouldSkip(id) {
  if (skip.has(id)) {
    record(id, "skipped", true, { reason: "explicitly skipped via --skip or --ci" }, "skipped");
    return true;
  }
  return false;
}

async function timed(fn) {
  const t = Date.now();
  try {
    const result = await fn();
    return { result, durationMs: Date.now() - t };
  } catch (err) {
    return { error: err, durationMs: Date.now() - t };
  }
}

async function sha256(file) {
  const buf = await fs.readFile(file);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function listFiles(dir) {
  const out = [];
  async function walk(d) {
    let entries;
    try { entries = await fs.readdir(d, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        await walk(full);
      } else if (e.isFile()) {
        out.push(full);
      }
    }
  }
  await walk(dir);
  return out.sort();
}

// ----------------------------------------------------------------------------
// Gate 1: source integrity manifest
// ----------------------------------------------------------------------------
if (!shouldSkip("source.integrity_manifest")) {
  const { result, error, durationMs } = await timed(async () => {
    const dirs = ["src", "scripts"];
    const files = [];
    for (const d of dirs) {
      const list = await listFiles(path.join(repoRoot, d));
      for (const f of list) files.push(f);
    }
    const manifest = {};
    for (const f of files) {
      const rel = path.relative(repoRoot, f).replace(/\\/g, "/");
      manifest[rel] = await sha256(f);
    }
    return { manifest, count: files.length };
  });
  if (error) {
    record("source.integrity_manifest", "required", false, {}, error.message, durationMs);
  } else {
    record("source.integrity_manifest", "required", true, {
      file_count: result.count,
      manifest_sha256: crypto
        .createHash("sha256")
        .update(JSON.stringify(result.manifest))
        .digest("hex")
    }, `${result.count} files hashed`, durationMs);
  }
}

// ----------------------------------------------------------------------------
// Gate 2: dependency parity (declared vs installed vs lockfile)
// ----------------------------------------------------------------------------
if (!shouldSkip("deps.parity")) {
  const { result, error, durationMs } = await timed(async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"));
    const declared = { ...pkg.dependencies };
    const installed = {};
    for (const dep of Object.keys(declared)) {
      const ppath = path.join(repoRoot, "node_modules", ...dep.split("/"), "package.json");
      try {
        const pp = JSON.parse(await fs.readFile(ppath, "utf8"));
        installed[dep] = pp.version;
      } catch {
        installed[dep] = null;
      }
    }
    const missing = Object.entries(installed).filter(([, v]) => !v);
    return { declared, installed, missing };
  });
  if (error) {
    record("deps.parity", "required", false, {}, error.message, durationMs);
  } else if (result.missing.length) {
    record("deps.parity", "required", false, result, `missing: ${result.missing.map((m) => m[0]).join(", ")}`, durationMs);
  } else {
    record("deps.parity", "required", true, result, `all ${Object.keys(result.declared).length} deps installed`, durationMs);
  }
}

// ----------------------------------------------------------------------------
// Gate 3: full unit suite via direct `node --test` subprocess.
// We avoid `npm test` here because npm's pipe routing under some shells eats
// the reporter output; calling node directly gives stable, parseable text.
// ----------------------------------------------------------------------------
if (!shouldSkip("tests.unit")) {
  const { result, durationMs } = await timed(async () => {
    return new Promise((resolve) => {
      const r = spawnSync(
        process.platform === "win32" ? "node.exe" : "node",
        ["--test", "scripts/coordination-smoke-test.mjs", "scripts/hardening-smoke-test.mjs"],
        { cwd: repoRoot, encoding: "utf8", shell: false }
      );
      resolve({ status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" });
    });
  });
  const combined = result.stdout + result.stderr;
  const passMatch = combined.match(/pass\s+(\d+)/i);
  const failMatch = combined.match(/fail\s+(\d+)/i);
  const passCount = passMatch ? Number(passMatch[1]) : 0;
  const failCount = failMatch ? Number(failMatch[1]) : -1;
  const ok = result.status === 0 && passCount > 0 && failCount === 0;
  record("tests.unit", "required", ok, {
    exit_code: result.status,
    pass_count: passCount,
    fail_count: failCount,
    stdout_tail: result.stdout.slice(-2000),
    stderr_tail: result.stderr.slice(-500)
  }, `pass=${passCount}, fail=${failCount}, exit=${result.status}`, durationMs);
}

const expectedTools = [
  "hermes_append_evidence",
  "hermes_approve_handoff",
  "hermes_claim_task",
  "hermes_create_blocked_handoff",
  "hermes_doctor",
  "hermes_emit_event",
  "hermes_get_state",
  "hermes_heartbeat",
  "hermes_list_events",
  "hermes_list_gates",
  "hermes_list_locks",
  "hermes_lock_files",
  "hermes_mark_event_handled",
  "hermes_read_policy",
  "hermes_recover_stale_locks",
  "hermes_release_files",
  "hermes_release_task",
  "hermes_request_handoff",
  "hermes_run_gate",
  "hermes_verify_evidence"
];

// ----------------------------------------------------------------------------
// Gate 4: stdio MCP handshake — initialize + tools/list shows expected tools
// ----------------------------------------------------------------------------
if (!shouldSkip("server.stdio_handshake")) {
  const { result, error, durationMs } = await timed(() => stdioHandshake({}));
  if (error) {
    record("server.stdio_handshake", "required", false, {}, error.message, durationMs);
  } else {
    const got = result.tools.sort();
    const missing = expectedTools.filter((t) => !got.includes(t));
    record("server.stdio_handshake", "required", missing.length === 0, {
      protocol_version: result.protocolVersion,
      server_name: result.serverInfo?.name,
      server_version: result.serverInfo?.version,
      tool_count: got.length,
      tools: got
    }, missing.length === 0 ? `${got.length} tools` : `missing: ${missing.join(",")}`, durationMs);
  }
}

// ----------------------------------------------------------------------------
// Gate 5: doctor against Hermes3D workspace (read-only, non-destructive)
// ----------------------------------------------------------------------------
if (!shouldSkip("doctor.hermes3d")) {
  const { result, error, durationMs } = await timed(async () => {
    const m = new HermesLockManager({ workspaceRoot: hermes3dWorkspace });
    return await m.doctor();
  });
  if (error) {
    record("doctor.hermes3d", "required", false, {}, error.message, durationMs);
  } else {
    const errs = result.findings.filter((f) => f.level === "error");
    record("doctor.hermes3d", "required", errs.length === 0, result,
      `ok=${result.ok}, ${result.findings.length} finding(s)`, durationMs);
  }
}

// ----------------------------------------------------------------------------
// Gate 6: durable event directories are present after initialization
// ----------------------------------------------------------------------------
if (!shouldSkip("events.directory_present")) {
  const { result, error, durationMs } = await timed(async () => {
    const sb = await fs.mkdtemp(path.join(os.tmpdir(), "truth-events-dir-"));
    try {
      const m = new HermesLockManager({ workspaceRoot: sb });
      await m.init();
      const paths = await ensureEventDirs(sb);
      const checks = {};
      for (const [id, dir] of Object.entries({
        outbox: paths.outboxDir,
        handled: paths.handledDir,
        failed: paths.failedDir
      })) {
        checks[id] = (await fs.stat(dir)).isDirectory();
      }
      return { sandbox: sb, checks };
    } finally {
      await fs.rm(sb, { recursive: true, force: true });
    }
  });
  if (error) {
    record("events.directory_present", "required", false, {}, error.message, durationMs);
  } else {
    const ok = Object.values(result.checks).every(Boolean);
    record("events.directory_present", "required", ok, result,
      ok ? "outbox/handled/failed present" : "one or more event dirs missing", durationMs);
  }
}

// ----------------------------------------------------------------------------
// Gate 7: trigger doctor end-to-end sandbox probe
// ----------------------------------------------------------------------------
if (!shouldSkip("trigger.doctor_passes")) {
  const { result, durationMs } = await timed(async () => {
    const sb = await fs.mkdtemp(path.join(os.tmpdir(), "truth-trigger-doctor-"));
    const r = spawnSync(
      process.platform === "win32" ? "node.exe" : "node",
      [path.join(repoRoot, "scripts", "trigger-doctor.mjs"), "--workspace", sb],
      { cwd: repoRoot, encoding: "utf8", shell: false }
    );
    let parsed = null;
    try { parsed = JSON.parse(r.stdout || "{}"); } catch {}
    await fs.rm(sb, { recursive: true, force: true });
    return { exit_code: r.status, stdout: r.stdout, stderr: r.stderr, parsed };
  });
  const ok = result.exit_code === 0 && result.parsed?.ok === true && result.parsed?.trigger_doctor_schema_version === 1;
  record("trigger.doctor_passes", "required", ok, {
    exit_code: result.exit_code,
    parsed: result.parsed,
    stderr_tail: (result.stderr || "").slice(-500)
  }, ok ? "trigger doctor ok" : `exit=${result.exit_code}`, durationMs);
}

// ----------------------------------------------------------------------------
// Gate 8: end-to-end multi-agent integration on a fresh git-initialized sandbox
// ----------------------------------------------------------------------------
if (!shouldSkip("e2e.multi_agent_flow")) {
  const { result, error, durationMs } = await timed(async () => {
    const sb = await fs.mkdtemp(path.join(os.tmpdir(), "truth-gate-sandbox-"));
    await fs.mkdir(path.join(sb, "03_implementation/ui/src/tabs"), { recursive: true });
    await fs.mkdir(path.join(sb, "contracts"), { recursive: true });
    await fs.writeFile(path.join(sb, "03_implementation/ui/src/tabs/Dashboard.tsx"), "// dash\n");
    await fs.writeFile(path.join(sb, "03_implementation/ui/src/tabs/Agents.tsx"), "// agents\n");
    await fs.writeFile(path.join(sb, "contracts/CP-UX-A_SCOPE_LOCK.md"), "# scope\n");
    await fs.writeFile(path.join(sb, "contracts/CP-UX-A_CODEX_IMPLEMENTATION.md"), "# codex\n");
    spawnSync("git", ["init", "-q", "-b", "main"], { cwd: sb });
    spawnSync("git", ["add", "-A"], { cwd: sb });
    spawnSync(
      "git",
      ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"],
      { cwd: sb }
    );

    const checks = [];
    await stdioHandshake({ MCP_LOCK_WORKSPACE: sb }, async (call) => {
      const policy = await call("hermes_read_policy", {});
      checks.push({ id: "policy.workspace_root", ok: policy.workspace_root === sb });

      const claudeTask = await call("hermes_claim_task", {
        owner: "claude-lead", taskId: "CP-UX-A-ARCHITECT", role: "architect",
        files: ["contracts/CP-UX-A_SCOPE_LOCK.md", "contracts/CP-UX-A_CODEX_IMPLEMENTATION.md"]
      });
      checks.push({ id: "task.claim", ok: claudeTask.ok === true });

      const claudeLock = await call("hermes_lock_files", {
        owner: "claude-lead", role: "architect", taskId: "CP-UX-A-ARCHITECT",
        files: ["contracts/CP-UX-A_SCOPE_LOCK.md", "contracts/CP-UX-A_CODEX_IMPLEMENTATION.md"]
      });
      checks.push({ id: "lock.docs", ok: claudeLock.ok === true });

      const codexLock = await call("hermes_lock_files", {
        owner: "codex-impl-01", role: "implementation", taskId: "CP-UX-A-CODEX",
        files: ["03_implementation/ui/src/tabs/Dashboard.tsx", "03_implementation/ui/src/tabs/Agents.tsx"]
      });
      checks.push({ id: "lock.code", ok: codexLock.ok === true });

      const blocked = await call("hermes_lock_files", {
        owner: "claude-reviewer-ux", role: "reviewer",
        files: ["03_implementation/ui/src/tabs/Dashboard.tsx"]
      });
      checks.push({
        id: "lock.blocked_by_codex",
        ok: blocked.ok === false &&
            blocked.status === "blocked" &&
            blocked.conflicts?.[0]?.current_owner === "codex-impl-01"
      });

      const handoff = await call("hermes_request_handoff", {
        requester: "claude-reviewer-ux", currentOwner: "codex-impl-01",
        files: ["03_implementation/ui/src/tabs/Dashboard.tsx"]
      });
      checks.push({ id: "handoff.requested", ok: handoff.ok === true });

      const approved = await call("hermes_approve_handoff", {
        owner: "codex-impl-01", requestId: handoff.handoff.id, decision: "approve"
      });
      checks.push({ id: "handoff.approved", ok: approved.ok === true && approved.status === "approved" });

      const reblock = await call("hermes_lock_files", {
        owner: "codex-impl-01", files: ["03_implementation/ui/src/tabs/Dashboard.tsx"]
      });
      checks.push({
        id: "handoff.codex_cannot_silently_recapture",
        ok: reblock.ok === false &&
            reblock.conflicts?.[0]?.current_owner === "claude-reviewer-ux"
      });

      const gateStatus = await call("hermes_run_gate", {
        owner: "claude-reviewer-ux", gateId: "git-status", cwd: "."
      });
      checks.push({ id: "gate.git_status", ok: gateStatus.ok === true });

      const gateDiffCheck = await call("hermes_run_gate", {
        owner: "claude-reviewer-ux", gateId: "git-diff-check", cwd: "."
      });
      checks.push({ id: "gate.git_diff_check", ok: gateDiffCheck.ok === true });

      const bogus = await call("hermes_run_gate", {
        owner: "claude-reviewer-ux", gateId: "definitely-not-a-real-gate", cwd: "."
      });
      checks.push({
        id: "gate.unknown_rejected",
        ok: bogus.ok === false && bogus.status === "rejected"
      });

      const escapedCwd = await call("hermes_run_gate", {
        owner: "claude-reviewer-ux", gateId: "git-status", cwd: "../.."
      });
      checks.push({
        id: "gate.escaped_cwd_rejected",
        ok: escapedCwd.ok === false &&
            (escapedCwd.message || "").toLowerCase().includes("escapes workspace")
      });

      const evidence = await call("hermes_append_evidence", {
        owner: "claude-reviewer-ux", taskId: "CP-UX-A-REVIEW",
        kind: "truth-gate", summary: "truth gate sandbox flow proved"
      });
      checks.push({ id: "evidence.appended", ok: evidence.ok === true });

      // release
      await call("hermes_release_files", {
        owner: "claude-lead",
        files: ["contracts/CP-UX-A_SCOPE_LOCK.md", "contracts/CP-UX-A_CODEX_IMPLEMENTATION.md"]
      });
      await call("hermes_release_files", {
        owner: "codex-impl-01",
        files: ["03_implementation/ui/src/tabs/Agents.tsx"]
      });
      await call("hermes_release_files", {
        owner: "claude-reviewer-ux",
        files: ["03_implementation/ui/src/tabs/Dashboard.tsx"]
      });
      const final = await call("hermes_get_state", {});
      checks.push({ id: "final.zero_locks", ok: final.locks.length === 0 });
    });

    const stateDir = path.join(sb, ".hermes3d_orchestrator");
    let ledgerLines = 0;
    let eventLines = 0;
    try {
      ledgerLines = (await fs.readFile(path.join(stateDir, "evidence", "ledger.ndjson"), "utf8"))
        .split("\n").filter(Boolean).length;
      eventLines = (await fs.readFile(path.join(stateDir, "events.ndjson"), "utf8"))
        .split("\n").filter(Boolean).length;
    } catch { /* tolerate */ }

    await fs.rm(sb, { recursive: true, force: true });
    return { sandbox: sb, checks, ledger_entries: ledgerLines, event_entries: eventLines };
  });
  if (error) {
    record("e2e.multi_agent_flow", "required", false, {}, error.message, durationMs);
  } else {
    const failed = result.checks.filter((c) => !c.ok);
    record("e2e.multi_agent_flow", "required", failed.length === 0, result,
      `${result.checks.length - failed.length}/${result.checks.length} checks; ` +
      `${result.ledger_entries} ledger, ${result.event_entries} events`, durationMs);
  }
}

// ----------------------------------------------------------------------------
// Gate 7: workspace integrity — Hermes3D's tracked tree is unmodified.
//
// We allow:
//   - Untracked state dir (.hermes3d_orchestrator/ or whatever MCP_LOCK_STATE_DIR
//     resolves to) — it is the orchestrator's own working data and is expected.
//   - The expected state-dir line being added to .gitignore by init-project.
//
// We do NOT allow:
//   - Probe files leaked into the workspace.
//   - Any modification (M / A / D / R / C) to a tracked file.
//   - Any UNEXPECTED untracked file (anything other than the state dir).
// ----------------------------------------------------------------------------
if (!shouldSkip("workspace.integrity")) {
  const { result, error, durationMs } = await timed(async () => {
    const stateDirName = process.env.MCP_LOCK_STATE_DIR || ".hermes3d_orchestrator";
    let stateDirPresent = false;
    try {
      const s = await fs.stat(path.join(hermes3dWorkspace, stateDirName));
      stateDirPresent = s.isDirectory();
    } catch { /* fine */ }

    let probeFiles = 0;
    try {
      const entries = await fs.readdir(hermes3dWorkspace);
      probeFiles = entries.filter((e) => e.startsWith(".mcp-lock-write-probe-")).length;
    } catch {}

    // `git status --porcelain` gives stable XY-prefixed lines.
    const gitStatus = spawnSync("git", ["-C", hermes3dWorkspace, "status", "--porcelain"], { encoding: "utf8" });
    const lines = (gitStatus.stdout || "").split("\n").filter(Boolean);
    const tracked_modifications = [];
    const untracked = [];
    for (const line of lines) {
      const xy = line.slice(0, 2);
      const filePath = line.slice(3);
      if (xy === "??") untracked.push(filePath);
      else tracked_modifications.push({ status: xy, path: filePath });
    }
    const allowedUntrackedPrefixes = [
      `${stateDirName}/`,
      `${stateDirName}`
    ];
    const unexpected_untracked = untracked.filter(
      (p) => !allowedUntrackedPrefixes.some((prefix) => p === prefix || p.startsWith(prefix))
    );

    // Classify each tracked modification: an install-related .gitignore tweak
    // is expected; anything else is a genuine workspace mutation.
    const install_related_modifications = [];
    const unexpected_modifications = [];
    for (const mod of tracked_modifications) {
      if (mod.path === ".gitignore") {
        const diff = spawnSync(
          "git",
          ["-C", hermes3dWorkspace, "diff", "--unified=0", "--", ".gitignore"],
          { encoding: "utf8" }
        );
        const added = (diff.stdout || "")
          .split("\n")
          .filter((l) => l.startsWith("+") && !l.startsWith("+++"));
        const installMarkers = [
          /Added by MCP Lock Orchestrator init/i,
          new RegExp(`^\\+\\s*${stateDirName.replace(/[.\\]/g, "\\$&")}/?\\s*$`),
          /tools\/hermes3d-mcp-lock-orchestrator\/node_modules\//
        ];
        const allAddedAreOurs = added.every((line) =>
          installMarkers.some((re) => re.test(line)) || line === "+"
        );
        if (allAddedAreOurs && added.length > 0) {
          install_related_modifications.push({ ...mod, kind: "install_marker", added_lines: added.length });
          continue;
        }
      }
      unexpected_modifications.push(mod);
    }

    return {
      state_dir_name: stateDirName,
      hermes3d_state_dir_present: stateDirPresent,
      probe_files_left: probeFiles,
      tracked_modifications,
      install_related_modifications,
      unexpected_modifications,
      untracked_paths: untracked,
      unexpected_untracked
    };
  });
  if (error) {
    record("workspace.integrity", "required", false, {}, error.message, durationMs);
  } else {
    const ok =
      result.probe_files_left === 0 &&
      result.unexpected_modifications.length === 0 &&
      result.unexpected_untracked.length === 0;
    record("workspace.integrity", "required", ok, result,
      `probes=${result.probe_files_left}, ` +
      `install_mods=${result.install_related_modifications.length}, ` +
      `unexpected_mods=${result.unexpected_modifications.length}, ` +
      `unexpected_untracked=${result.unexpected_untracked.length}`, durationMs);
  }
}

// ----------------------------------------------------------------------------
// Gate 8: client config presence (Claude Desktop, Codex, Windsurf)
// ----------------------------------------------------------------------------
if (!shouldSkip("clients.config_presence")) {
  const { result, error, durationMs } = await timed(async () => {
    const home = os.homedir();
    const claudeDesktop = process.platform === "win32"
      ? path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json")
      : process.platform === "darwin"
        ? path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json")
        : path.join(home, ".config", "Claude", "claude_desktop_config.json");
    const windsurf = path.join(home, ".codeium", "windsurf", "mcp_config.json");
    const codex = path.join(home, ".codex", "config.toml");
    const claudeCode = path.join(home, ".claude.json");

    async function jsonHasServer(file) {
      try {
        const j = JSON.parse(await fs.readFile(file, "utf8"));
        const present = !!(j.mcpServers && j.mcpServers["hermes3d-locks"]);
        return { exists: true, present, server_count: Object.keys(j.mcpServers || {}).length };
      } catch (err) {
        if (err.code === "ENOENT") return { exists: false, present: false };
        return { exists: true, present: false, parse_error: err.message };
      }
    }
    async function tomlHasStanza(file) {
      try {
        const raw = await fs.readFile(file, "utf8");
        return { exists: true, present: raw.includes("[mcp_servers.hermes3d-locks]") };
      } catch (err) {
        if (err.code === "ENOENT") return { exists: false, present: false };
        return { exists: true, present: false, error: err.message };
      }
    }
    async function claudeCodeHasServer(file) {
      try {
        const raw = await fs.readFile(file, "utf8");
        // Claude Code stores in JSON; do not parse the entire user file (huge).
        // We just need the substring presence check, which is what `claude mcp add` writes.
        return { exists: true, present: raw.includes('"hermes3d-locks"') };
      } catch (err) {
        if (err.code === "ENOENT") return { exists: false, present: false };
        return { exists: true, present: false, error: err.message };
      }
    }

    return {
      claude_desktop: { path: claudeDesktop, ...(await jsonHasServer(claudeDesktop)) },
      windsurf:       { path: windsurf,       ...(await jsonHasServer(windsurf)) },
      codex:          { path: codex,          ...(await tomlHasStanza(codex)) },
      claude_code:    { path: claudeCode,     ...(await claudeCodeHasServer(claudeCode)) }
    };
  });
  if (error) {
    record("clients.config_presence", "required", false, {}, error.message, durationMs);
  } else {
    const missing = Object.entries(result).filter(([, v]) => !v.present).map(([k]) => k);
    record("clients.config_presence", "required", missing.length === 0, result,
      missing.length ? `missing: ${missing.join(",")}` : "all 4 present", durationMs);
  }
}

// ----------------------------------------------------------------------------
// Gate 9: live Claude Code connectivity via `claude mcp list`
// ----------------------------------------------------------------------------
if (!shouldSkip("clients.claude_code_live")) {
  const { result, durationMs } = await timed(async () => {
    const r = spawnSync(process.platform === "win32" ? "claude.exe" : "claude",
      ["mcp", "list"], { encoding: "utf8" });
    return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "", error: r.error?.code };
  });
  if (result.error === "ENOENT") {
    record("clients.claude_code_live", "warn", false, result, "claude CLI not on PATH", durationMs);
  } else {
    const line = (result.stdout.split("\n").find((l) => l.includes("hermes3d-locks")) || "").trim();
    const connected = /✓\s*Connected/i.test(line);
    record("clients.claude_code_live", "required", connected, {
      exit_code: result.status,
      matched_line: line
    }, connected ? "Connected" : `not connected (line: ${line || "<missing>"})`, durationMs);
  }
}

// ----------------------------------------------------------------------------
// Gate 10: tool description hygiene — lints src/server.mjs for prompt-injection
// markers in tool descriptions/titles (ignore previous, you must, base64
// blobs, zero-width chars, HTML tags). OWASP MCP "tool poisoning" defense.
// ----------------------------------------------------------------------------
if (!shouldSkip("server.tool_description_hygiene")) {
  const { result, error, durationMs } = await timed(async () => {
    const src = await fs.readFile(path.join(repoRoot, "src", "server.mjs"), "utf8");
    const patterns = [
      { name: "ignore_previous", re: /ignore\s+(all\s+)?previous/i },
      { name: "you_must", re: /\byou\s+must\b/i },
      { name: "always_directive", re: /\byou\s+(should\s+)?always\b/i },
      { name: "long_base64", re: /[A-Za-z0-9+/=]{60,}/ },
      { name: "zero_width", re: /[​‌‍⁠﻿]/ },
      { name: "html_executable", re: /<\s*(script|iframe|object|embed)\b/i }
    ];
    const findings = [];
    for (const p of patterns) {
      const m = src.match(p.re);
      if (m) findings.push({ pattern: p.name, sample: m[0].slice(0, 80) });
    }
    return { findings, file: "src/server.mjs", bytes: Buffer.byteLength(src, "utf8") };
  });
  if (error) {
    record("server.tool_description_hygiene", "required", false, {}, error.message, durationMs);
  } else {
    const ok = result.findings.length === 0;
    record("server.tool_description_hygiene", "required", ok, result,
      ok ? "0 suspicious patterns" : `${result.findings.length} pattern(s): ${result.findings.map((f) => f.pattern).join(", ")}`,
      durationMs);
  }
}

// ----------------------------------------------------------------------------
// Gate 11: evidence hash-chain validity — round-trips appendChainedJsonLine
// and verifyChainedLog through a positive case (3 valid entries) and a
// negative case (mid-chain tamper detected at the right index).
// ----------------------------------------------------------------------------
if (!shouldSkip("evidence.hash_chain_valid")) {
  const { result, error, durationMs } = await timed(async () => {
    const { appendChainedJsonLine, verifyChainedLog } = await import("../src/core/fs-utils.mjs");
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hp-chain-"));
    const ledger = path.join(tmpDir, "ledger.ndjson");
    try {
      await appendChainedJsonLine(ledger, { id: "e1", note: "first" });
      await appendChainedJsonLine(ledger, { id: "e2", note: "second" });
      await appendChainedJsonLine(ledger, { id: "e3", note: "third" });

      const verifyClean = await verifyChainedLog(ledger);
      const positive =
        verifyClean.ok === true &&
        verifyClean.chained === 3 &&
        verifyClean.unchained === 0 &&
        verifyClean.first_break === null;

      // Tamper: rewrite middle entry's note (entry_hash will no longer match canonical)
      const raw = await fs.readFile(ledger, "utf8");
      const lines = raw.split("\n").filter(Boolean);
      const middle = JSON.parse(lines[1]);
      middle.note = "FORGED";
      lines[1] = JSON.stringify(middle);
      await fs.writeFile(ledger, lines.join("\n") + "\n", "utf8");

      const verifyTampered = await verifyChainedLog(ledger);
      const negative =
        verifyTampered.ok === false &&
        verifyTampered.first_break !== null &&
        verifyTampered.first_break.index === 1;

      return { positive, negative, verifyClean, verifyTampered };
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
  if (error) {
    record("evidence.hash_chain_valid", "required", false, {}, error.message, durationMs);
  } else {
    const ok = result.positive && result.negative;
    record("evidence.hash_chain_valid", "required", ok, result,
      `positive=${result.positive}, negative_detected_at_idx_1=${result.negative}`, durationMs);
  }
}

// ----------------------------------------------------------------------------
// Gate 12: master-prompt deliverables present
//
// The master prompt (hermesproof_claude20_codex_handoff_master_prompt.md §3)
// requires 10 deliverable files before Codex starts implementation. This gate
// verifies they exist and are non-empty, so the design contract cannot silently
// rot away from the artifact it justifies.
// ----------------------------------------------------------------------------
if (!shouldSkip("docs.master_prompt_deliverables_present")) {
  const { result, error, durationMs } = await timed(async () => {
    const required = [
      "docs/README_MASTER_SPEC.md",
      "docs/README_COVERAGE_MATRIX.md",
      "docs/VISUAL_ASSET_SPEC.md",
      "docs/SVG_ANIMATION_SPEC.md",
      "docs/HERMES3D_SOURCE_AUDIT.md",
      "docs/HERMESPROOF_SETUP_AUDIT.md",
      "docs/CODEX_IMPLEMENTATION_HANDOFF.md",
      "docs/CLAUDE_REVIEW_TEAM_PROMPT.md",
      "docs/ACCEPTANCE_GATES.md",
      "handoffs/HANDOFF_TO_CODEX_README_VISUALS.md"
    ];
    const minBytes = 256; // anything shorter is a placeholder, not a deliverable
    const findings = [];
    for (const rel of required) {
      const full = path.join(repoRoot, rel);
      try {
        const buf = await fs.readFile(full, "utf8");
        const size = Buffer.byteLength(buf, "utf8");
        const hasH1 = /^# \S/m.test(buf);
        findings.push({
          path: rel,
          ok: size >= minBytes && hasH1,
          size_bytes: size,
          has_h1: hasH1
        });
      } catch (err) {
        findings.push({ path: rel, ok: false, error: err.code || err.message });
      }
    }
    return { required_count: required.length, findings };
  });
  if (error) {
    record("docs.master_prompt_deliverables_present", "required", false, {}, error.message, durationMs);
  } else {
    const failed = result.findings.filter((f) => !f.ok);
    record("docs.master_prompt_deliverables_present", "required", failed.length === 0, result,
      failed.length === 0
        ? `${result.required_count}/${result.required_count} deliverables present`
        : `missing/empty: ${failed.map((f) => f.path).join(", ")}`,
      durationMs);
  }
}

// ----------------------------------------------------------------------------
// Helper: spawn the MCP server, perform initialize, and optionally make tool calls.
// ----------------------------------------------------------------------------
async function stdioHandshake(extraEnv, withCalls) {
  const serverEntry = path.join(repoRoot, "src", "server.mjs");
  return new Promise((resolve, reject) => {
    const proc = spawn(process.platform === "win32" ? "node.exe" : "node", [serverEntry], {
      env: { ...process.env, ...extraEnv },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let buf = "";
    let id = 0;
    const queue = [];
    const stderrChunks = [];
    proc.stderr.on("data", (d) => stderrChunks.push(d.toString()));
    proc.on("error", (err) => reject(err));
    proc.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        const next = queue.shift();
        if (next) next(msg);
      }
    });
    function request(method, params) {
      id++;
      return new Promise((r) => {
        queue.push(r);
        proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      });
    }
    function notify(method, params) {
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
    }
    async function call(name, args) {
      const resp = await request("tools/call", { name, arguments: args });
      const text = resp?.result?.content?.[0]?.text;
      if (!text) throw new Error(`no text content for tool ${name}: ${JSON.stringify(resp)}`);
      return JSON.parse(text);
    }

    (async () => {
      try {
        const init = await request("initialize", {
          protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "truth-gate", version: "0.0.1" }
        });
        notify("notifications/initialized", {});
        const list = await request("tools/list", {});
        const tools = list?.result?.tools?.map((t) => t.name) || [];
        if (withCalls) await withCalls(call);
        proc.stdin.end();
        proc.kill("SIGTERM");
        resolve({
          protocolVersion: init?.result?.protocolVersion,
          serverInfo: init?.result?.serverInfo,
          tools
        });
      } catch (err) {
        proc.kill("SIGKILL");
        reject(new Error(`${err.message}; stderr=${stderrChunks.join("").slice(-500)}`));
      }
    })();
  });
}

// ----------------------------------------------------------------------------
// Final report
// ----------------------------------------------------------------------------
const totalMs = Date.now() - runStart;
const failures = gates.filter((g) => !g.ok && g.level === "required");
const warnings = gates.filter((g) => !g.ok && g.level === "warn");
const skipped = gates.filter((g) => g.level === "skipped");
const passed = gates.filter((g) => g.ok && g.level !== "skipped");

const report = {
  run_id: runId,
  ts_utc: runIso,
  duration_ms: totalMs,
  ok: failures.length === 0,
  pass_count: passed.length,
  fail_count: failures.length,
  warn_count: warnings.length,
  skip_count: skipped.length,
  hermes3d_workspace: hermes3dWorkspace,
  node_version: process.version,
  platform: process.platform,
  repo_root: repoRoot,
  gates
};

const proofDir = path.join(repoRoot, "PROOF");
await fs.mkdir(proofDir, { recursive: true });
await fs.writeFile(
  path.join(proofDir, "latest.json"),
  JSON.stringify(report, null, 2) + "\n",
  "utf8"
);

// Render markdown summary
function levelTag(g) {
  if (g.ok) return "✅ pass";
  if (g.level === "required") return "❌ fail";
  return "⚠️ warn";
}
const md = [
  `# End-to-End Truth-Gate Report`,
  ``,
  `- **Run id**: \`${runId}\``,
  `- **Timestamp (UTC)**: ${runIso}`,
  `- **Duration**: ${(totalMs / 1000).toFixed(2)}s`,
  `- **Hermes3D workspace**: \`${hermes3dWorkspace}\``,
  `- **Node**: ${process.version} on ${process.platform}`,
  `- **Result**: ${report.ok ? "✅ ALL REQUIRED GATES PASS" : `❌ ${failures.length} REQUIRED GATE(S) FAILED`}`,
  ``,
  `Pass / Fail / Warn / Skip: **${report.pass_count} / ${failures.length} / ${warnings.length} / ${skipped.length}**`,
  ``,
  `## Gate results`,
  ``,
  `| Gate | Level | Result | Duration | Detail |`,
  `| --- | --- | --- | --- | --- |`,
  ...gates.map((g) =>
    `| \`${g.id}\` | ${g.level} | ${levelTag(g)} | ${g.duration_ms} ms | ${(g.details || "").replace(/\|/g, "\\|") || "—"} |`
  ),
  ``,
  `## Machine-readable report`,
  ``,
  `Full evidence including evidence ledgers, tool call shapes, manifest hashes, and config snapshots is in:`,
  ``,
  `\`PROOF/latest.json\``,
  ``,
  `## Reproduce`,
  ``,
  `\`\`\`powershell`,
  `cd ${repoRoot.replace(/\\/g, "\\\\")}`,
  `npm install`,
  `node scripts/truth-gates.mjs --workspace "${hermes3dWorkspace}"`,
  `\`\`\``,
  ``,
  `Exit code 0 means every required gate passed; non-zero means at least one required gate failed.`,
  ``
].join("\n");

await fs.writeFile(path.join(repoRoot, "PROOF_E2E_REPORT.md"), md, "utf8");

console.log("");
console.log(`PROOF/latest.json     written (${(JSON.stringify(report).length / 1024).toFixed(1)} KB)`);
console.log(`PROOF_E2E_REPORT.md   written`);
console.log("");
console.log(`Pass: ${report.pass_count}   Fail: ${failures.length}   Warn: ${warnings.length}   Skip: ${skipped.length}   Duration: ${(totalMs / 1000).toFixed(2)}s`);
process.exit(failures.length === 0 ? 0 : 1);
