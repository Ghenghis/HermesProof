import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  classifyUses,
  parseUsesFromWorkflow,
  runWorkflowPinningGate,
  listWorkflowFiles
} from "./workflow-pinning-gate.mjs";

test("classifyUses: 40-char SHA pin is OK", () => {
  const v = classifyUses("actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683");
  assert.equal(v.ok, true);
  assert.equal(v.kind, "github");
});

test("classifyUses: rejects @v4 tag", () => {
  const v = classifyUses("actions/checkout@v4");
  assert.equal(v.ok, false);
  assert.equal(v.kind, "github");
  assert.match(v.reason, /v4/);
  assert.ok(v.fix && v.fix.includes("40-hex"));
});

test("classifyUses: rejects @main branch ref", () => {
  const v = classifyUses("some/action@main");
  assert.equal(v.ok, false);
});

test("classifyUses: rejects 7-char short sha", () => {
  const v = classifyUses("some/action@1234abc");
  assert.equal(v.ok, false);
  assert.match(v.reason, /1234abc/);
});

test("classifyUses: rejects missing @", () => {
  const v = classifyUses("actions/checkout");
  assert.equal(v.ok, false);
  assert.match(v.reason, /missing @/);
});

test("classifyUses: accepts local ./", () => {
  const v = classifyUses("./.github/actions/setup");
  assert.equal(v.ok, true);
  assert.equal(v.kind, "local");
});

test("classifyUses: accepts ../ relative reusable workflow", () => {
  const v = classifyUses("../local/workflow.yml");
  assert.equal(v.ok, true);
  assert.equal(v.kind, "local");
});

test("classifyUses: accepts docker:// with sha256 digest", () => {
  const v = classifyUses(
    "docker://example/image@sha256:" + "a".repeat(64)
  );
  assert.equal(v.ok, true);
  assert.equal(v.kind, "docker");
});

test("classifyUses: rejects docker:// with tag", () => {
  const v = classifyUses("docker://example/image@latest");
  assert.equal(v.ok, false);
  assert.equal(v.kind, "docker");
});

test("classifyUses: rejects docker:// missing @", () => {
  const v = classifyUses("docker://example/image");
  assert.equal(v.ok, false);
  assert.equal(v.kind, "docker");
});

test("classifyUses: handles sub-path action with SHA", () => {
  const v = classifyUses(
    "org/repo/sub/path@" + "0".repeat(40)
  );
  assert.equal(v.ok, true);
  assert.equal(v.kind, "github");
});

test("classifyUses: rejects non-org/repo unknown shape", () => {
  const v = classifyUses("just-a-name@" + "0".repeat(40));
  assert.equal(v.ok, false);
  assert.equal(v.kind, "unknown");
});

test("parseUsesFromWorkflow: extracts uses lines, skips comments", () => {
  const yaml = [
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      # uses: actions/foo@v1  (commented out)",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "      - name: Step",
    "        uses: 'actions/setup-node@" + "b".repeat(40) + "'  # comment",
    "        with:",
    "          node-version: 20"
  ].join("\n");
  const refs = parseUsesFromWorkflow(yaml);
  assert.equal(refs.length, 2);
  assert.equal(refs[0].ref, "actions/checkout@" + "a".repeat(40));
  assert.equal(refs[1].ref, "actions/setup-node@" + "b".repeat(40));
});

test("parseUsesFromWorkflow: ignores lines that say 'uses' inside a string", () => {
  const yaml = [
    "name: test",
    "description: this script uses actions, but it is text",
    "jobs:",
    "  x:",
    "    steps:",
    "      - uses: real/action@" + "c".repeat(40)
  ].join("\n");
  const refs = parseUsesFromWorkflow(yaml);
  assert.equal(refs.length, 1);
});

test("runWorkflowPinningGate: passes on a clean fixture", async () => {
  const sb = await fs.mkdtemp(path.join(os.tmpdir(), "hp-wfpin-"));
  try {
    const wf = path.join(sb, ".github", "workflows");
    await fs.mkdir(wf, { recursive: true });
    await fs.writeFile(path.join(wf, "ci.yml"),
      "jobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n" +
      "      - uses: actions/checkout@" + "0".repeat(40) + "\n" +
      "      - uses: ./local-action\n"
    );
    const result = await runWorkflowPinningGate({ repoRoot: sb });
    assert.equal(result.ok, true);
    assert.equal(result.evidence.workflow_count, 1);
    assert.equal(result.evidence.uses_count, 2);
    assert.deepEqual(result.evidence.violations, []);
  } finally {
    await fs.rm(sb, { recursive: true, force: true });
  }
});

test("runWorkflowPinningGate: fails on tagged ref and reports fix", async () => {
  const sb = await fs.mkdtemp(path.join(os.tmpdir(), "hp-wfpin-"));
  try {
    const wf = path.join(sb, ".github", "workflows");
    await fs.mkdir(wf, { recursive: true });
    await fs.writeFile(path.join(wf, "bad.yml"),
      "jobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n" +
      "      - uses: actions/checkout@v4\n" +
      "      - uses: actions/setup-node@" + "0".repeat(40) + "\n"
    );
    const result = await runWorkflowPinningGate({ repoRoot: sb });
    assert.equal(result.ok, false);
    assert.equal(result.evidence.violations.length, 1);
    assert.equal(result.evidence.violations[0].ref, "actions/checkout@v4");
    assert.ok(result.evidence.violations[0].fix.includes("40-hex"));
    assert.match(result.details, /1 unpinned/);
  } finally {
    await fs.rm(sb, { recursive: true, force: true });
  }
});

test("runWorkflowPinningGate: handles repo with no workflows", async () => {
  const sb = await fs.mkdtemp(path.join(os.tmpdir(), "hp-wfpin-"));
  try {
    const result = await runWorkflowPinningGate({ repoRoot: sb });
    assert.equal(result.ok, true);
    assert.equal(result.evidence.workflow_count, 0);
    assert.equal(result.evidence.uses_count, 0);
  } finally {
    await fs.rm(sb, { recursive: true, force: true });
  }
});

test("runWorkflowPinningGate: real HermesProof workflows are clean", async () => {
  // Validates against the actual repo's .github/workflows/*.yml so the gate
  // self-asserts on every test run.
  const here = path.dirname(new URL(import.meta.url).pathname);
  const repoRoot = path.resolve(
    here.replace(/^\/([A-Za-z]):/, "$1:"),
    ".."
  );
  const files = await listWorkflowFiles(repoRoot);
  if (files.length === 0) {
    return; // CI may run this in a stripped checkout
  }
  const result = await runWorkflowPinningGate({ repoRoot });
  if (!result.ok) {
    // Surface the violations clearly in the failure message.
    const lines = result.evidence.violations
      .map((v) => `  ${v.file}:${v.lineno}  ${v.ref}  -- ${v.reason}`)
      .join("\n");
    assert.fail(
      `Real workflows have unpinned uses (gate must be green before merge):\n${lines}`
    );
  }
  assert.equal(result.ok, true);
});
