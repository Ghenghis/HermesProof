import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { evaluateWorkspaceHygiene } from "./workspace-hygiene.mjs";

let tmp;

function git(args) {
  const proc = spawnSync("git", ["-C", tmp, ...args], { encoding: "utf8" });
  assert.equal(proc.status, 0, proc.stderr || proc.stdout);
  return proc.stdout;
}

async function write(file, text) {
  await fs.mkdir(path.dirname(path.join(tmp, file)), { recursive: true });
  await fs.writeFile(path.join(tmp, file), text, "utf8");
}

async function initRepo() {
  git(["init"]);
  await write("README.md", "# test\n");
  git(["add", "README.md"]);
  git(["-c", "user.email=test@example.invalid", "-c", "user.name=Test Agent", "commit", "-m", "init"]);
}

describe("workspace hygiene", () => {
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hp-hygiene-"));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("accepts a clean git workspace and does not perform destructive actions", async () => {
    await initRepo();

    const result = await evaluateWorkspaceHygiene({ workspaceRoot: tmp });

    assert.equal(result.ok, true);
    assert.equal(result.release_ready, true);
    assert.equal(result.status, "clean");
    assert.equal(result.verdict, "pass");
    assert.equal(result.truth, "proven");
    assert.deepEqual(result.destructive_actions_performed, []);
  });

  it("blocks release readiness for tracked and untracked dirty files", async () => {
    await initRepo();
    await write("README.md", "# changed\n");
    await write("notes.txt", "local note\n");

    const result = await evaluateWorkspaceHygiene({ workspaceRoot: tmp });

    assert.equal(result.ok, false);
    assert.equal(result.release_ready, false);
    assert.equal(result.status, "dirty_blocked");
    assert.deepEqual(result.unexpected_untracked, ["notes.txt"]);
    assert.equal(result.unexpected_modifications[0].path, "README.md");
    assert.ok(result.safe_actions.some((action) => /never runs it automatically/i.test(action)));
    assert.ok(result.safe_actions.some((action) => /Do not run git reset/i.test(action)));
    assert.deepEqual(result.destructive_actions_performed, []);
  });

  it("keeps path-classified dirty work blocked until it is hash-bound", async () => {
    await initRepo();
    await write("README.md", "# changed\n");
    await write("local-report.json", "{}\n");
    await write(".hermes3d_orchestrator/expected-diff.json", JSON.stringify({
      schema_version: 1,
      reason: "operator reviewed local release evidence",
      entries: [
        { path: "README.md", status: "M" },
        { path: "local-report.json", status: "??" },
      ],
    }, null, 2));

    const blocked = await evaluateWorkspaceHygiene({
      workspaceRoot: tmp,
      expectedManifestPath: ".hermes3d_orchestrator/expected-diff.json",
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.status, "expected_manifest_invalid");
    assert.equal(blocked.expected_modifications.length, 1);
    assert.equal(blocked.expected_untracked.length, 1);

    const allowed = await evaluateWorkspaceHygiene({
      workspaceRoot: tmp,
      expectedManifestPath: ".hermes3d_orchestrator/expected-diff.json",
      allowExpectedDirty: true,
    });
    assert.equal(allowed.ok, false);
    assert.equal(allowed.release_ready, false);
    assert.equal(allowed.recovery_ready, false);
    assert.equal(allowed.status, "expected_manifest_invalid");
  });

  it("recognizes a hash-bound recovery batch without calling it clean", async () => {
    await initRepo();
    await write("README.md", "# changed\n");
    const raw = await fs.readFile(path.join(tmp, "README.md"));
    const sha = crypto.createHash("sha256").update(raw).digest("hex");
    const head = git(["rev-parse", "HEAD"]).trim();
    const branch = git(["branch", "--show-current"]).trim();
    await write(".hermes3d_orchestrator/expected-diff.json", JSON.stringify({
      schema: "hermesproof.expected-diff-manifest.v2",
      head,
      branch,
      reviewedAtUtc: "2026-07-10T22:00:00.000Z",
      releaseClaimAllowed: false,
      entries: [{ path: "README.md", status: "M", classification: "KEEP_RECOVERY_FIX", sha256: sha }],
    }, null, 2));

    const result = await evaluateWorkspaceHygiene({
      workspaceRoot: tmp,
      expectedManifestPath: ".hermes3d_orchestrator/expected-diff.json",
      allowExpectedDirty: true,
    });

    assert.equal(result.ok, false);
    assert.equal(result.release_ready, false);
    assert.equal(result.recovery_ready, true);
    assert.equal(result.verdict, "blocked");
    assert.equal(result.status, "reviewed_recovery_dirty");
    assert.equal(result.manifest_facts.integrity, "hash-bound");
  });

  it("keeps probe files release-blocking even in an otherwise clean workspace", async () => {
    await initRepo();
    await write(".mcp-lock-write-probe-test", "leaked\n");

    const result = await evaluateWorkspaceHygiene({ workspaceRoot: tmp });

    assert.equal(result.ok, false);
    assert.equal(result.release_ready, false);
    assert.equal(result.probe_files_left, 1);
    assert.equal(result.status, "dirty_blocked");
  });
});
