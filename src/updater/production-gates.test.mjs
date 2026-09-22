import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  CANDIDATE_REQUIRED_GATES
} from "./release-verifier.mjs";
import { createProductionCandidateGates } from "./production-gates.mjs";
import { signReleasePointer } from "../core/release-pointer.mjs";

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
  // The gate set is a superset of the required gates: "release-pointer-signature"
  // is deliberately built but NOT (yet) required (see production-gates.mjs) so
  // enabling it is an explicit, separate decision, not something that ships on
  // by default the moment this file changes.
  assert.deepEqual(Object.keys(gates).slice(0, CANDIDATE_REQUIRED_GATES.length), CANDIDATE_REQUIRED_GATES);
  assert.ok(Object.keys(gates).includes("release-pointer-signature"));
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

test("release-pointer-signature gate fails closed when not configured, and reads trust from outside the candidate directory", async (t) => {
  const trustRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hp-production-gates-trust-"));
  t.after(() => fs.rm(trustRoot, { recursive: true, force: true }));
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const privateKeyFile = path.join(trustRoot, "private.pem");
  const pointerPublicKeyFile = path.join(trustRoot, "public.pem");
  await fs.writeFile(privateKeyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
  await fs.writeFile(pointerPublicKeyFile, publicKey.export({ type: "spki", format: "pem" }));

  const unconfigured = createProductionCandidateGates({ runner: async () => ({ exitCode: 0, stdout: "", stderr: "" }) });
  const unconfiguredResult = await unconfigured["release-pointer-signature"]({ sha: SHA, directory: "/does-not-matter", channel: "stable" });
  assert.equal(unconfiguredResult.ok, false);
  assert.match(unconfiguredResult.reason, /not configured/);

  const gates = createProductionCandidateGates({
    runner: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    trustRoot,
    pointerPublicKeyFile
  });

  // No pointer signed yet for this channel -- must fail closed, not pass.
  const noPointer = await gates["release-pointer-signature"]({ sha: SHA, directory: "/does-not-matter", channel: "stable" });
  assert.equal(noPointer.ok, false);
  assert.equal(noPointer.reason, "pointer_missing");

  // Bless a DIFFERENT sha -- the candidate SHA must still be rejected even
  // though a validly-signed pointer file exists, proving this isn't just
  // "any signed file passes."
  await signReleasePointer({
    sha: "f".repeat(40),
    channel: "stable",
    privateKeyFile,
    publicKeyFile: pointerPublicKeyFile,
    pointerFile: path.join(trustRoot, "release-pointer-stable.json")
  });
  const wrongSha = await gates["release-pointer-signature"]({ sha: SHA, directory: "/does-not-matter", channel: "stable" });
  assert.equal(wrongSha.ok, false);
  assert.equal(wrongSha.reason, "sha_not_blessed");

  // Bless the actual candidate SHA -- now it passes, and the gate never
  // touched `directory` (the untrusted candidate) to reach this trust
  // decision, only trustRoot/pointerPublicKeyFile passed in at gate-set
  // construction time.
  await signReleasePointer({
    sha: SHA,
    channel: "stable",
    privateKeyFile,
    publicKeyFile: pointerPublicKeyFile,
    pointerFile: path.join(trustRoot, "release-pointer-stable.json")
  });
  const blessed = await gates["release-pointer-signature"]({ sha: SHA, directory: "/does-not-matter", channel: "stable" });
  assert.equal(blessed.ok, true, JSON.stringify(blessed));
});
