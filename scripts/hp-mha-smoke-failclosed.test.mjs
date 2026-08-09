import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

function runSmoke(env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["examples/hp-mha/smoke-e2e.mjs"], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("HP-MHA smoke uses a verified Merkle root before printing PASS", async () => {
  const result = await runSmoke();
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /trace_bundle_verify ok = true/);
  assert.match(result.stdout, /trace_index_record row_count = 3 merkle_ok = true/);
  assert.match(result.stdout, /END-TO-END PASS/);
  assert.doesNotMatch(result.stdout, /placeholder|mismatch expected|verification_ok\s*=\s*false/i);
});

test("HP-MHA smoke exits nonzero and never prints PASS when the trace is tampered", async () => {
  const result = await runSmoke({ HP_MHA_SMOKE_TAMPER_TRACE: "1" });
  assert.notEqual(result.code, 0);
  assert.doesNotMatch(result.stdout, /END-TO-END PASS/);
  assert.match(`${result.stdout}\n${result.stderr}`, /trace_bundle_verify|trace bundle verification failed|Merkle/i);
});
