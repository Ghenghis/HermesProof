import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  CANDIDATE_REQUIRED_GATES
} from "./release-verifier.mjs";
import { createProductionCandidateGates } from "./production-gates.mjs";

const SHA = "e".repeat(40);

test("production gate set covers every required row and uses exact argv", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "hp-production-gates-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, "package-lock.json"), "{}\n", "utf8");
  await fs.mkdir(path.join(directory, ".serena"), { recursive: true });
  await fs.writeFile(path.join(directory, ".serena", "project.yml"), "languages:\n- typescript\nread_only: true\n", "utf8");
  const calls = [];
  const runner = async (input) => {
    calls.push(input);
    if (input.args.includes("rev-parse")) return { exitCode: 0, stdout: SHA + "\n", stderr: "" };
    if (input.args.includes("status")) return { exitCode: 0, stdout: "", stderr: "" };
    return { exitCode: 0, stdout: "ok\n", stderr: "" };
  };
  const probes = [];
  const gates = createProductionCandidateGates({
    runner,
    probe: async ({ server }) => {
      probes.push(server);
      return { ok: true, server, toolCount: server === "hermes3d-locks" ? 121 : 34 };
    }
  });
  assert.deepEqual(Object.keys(gates), CANDIDATE_REQUIRED_GATES);
  for (const name of CANDIDATE_REQUIRED_GATES) {
    const result = await gates[name]({ sha: SHA, directory, channel: "stable" });
    assert.equal(result.ok, true, name);
  }
  assert.deepEqual(probes, ["hermes3d-locks", "hp-mha-serena"]);
  assert.equal(calls.every((call) => call.command && Array.isArray(call.args)), true);
  assert.equal(calls.some((call) => call.args.includes("ci") && call.args.includes("--ignore-scripts")), true);
  assert.equal(calls.some((call) => call.args.includes("hp-mha:smoke-e2e")), true);
});

test("source, dependency, Serena, and MCP gates fail closed on drift", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "hp-production-gates-fail-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, "package-lock.json"), "{}\n", "utf8");
  await fs.mkdir(path.join(directory, ".serena"), { recursive: true });
  await fs.writeFile(path.join(directory, ".serena", "project.yml"), "languages:\n- python\nread_only: false\n", "utf8");
  const gates = createProductionCandidateGates({
    runner: async ({ args }) => {
      if (args.includes("rev-parse")) return { exitCode: 0, stdout: "f".repeat(40) + "\n", stderr: "" };
      return { exitCode: 0, stdout: "", stderr: "" };
    },
    probe: async () => ({ ok: false, reason: "no tools" })
  });
  assert.equal((await gates["source-integrity"]({ sha: SHA, directory })).ok, false);
  assert.equal((await gates["serena-config"]({ sha: SHA, directory })).ok, false);
  assert.equal((await gates["mcp-hermes3d-locks"]({ sha: SHA, directory })).ok, false);
});
