import test from "node:test";
import assert from "node:assert/strict";

import { runProcess } from "./process-runner.mjs";

test("process runner executes Windows npm and npx shims without a command shell", {
  skip: process.platform !== "win32"
}, async () => {
  for (const command of ["npm.cmd", "npx.cmd"]) {
    const result = await runProcess({
      command,
      args: ["--version"],
      timeoutMs: 10_000,
      maxOutputBytes: 64 * 1024
    });
    assert.equal(result.exitCode, 0, command);
    assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, command);
  }
});

test("process runner preserves exact argv and exposes only an allowlisted environment", async () => {
  const result = await runProcess({
    command: process.execPath,
    args: [
      "-e",
      "process.stdout.write(JSON.stringify({ argv: process.argv.slice(1), safe: process.env.HP_SAFE, secret: process.env.HP_SECRET }))",
      "value with spaces",
      "literal;still-an-argument"
    ],
    environment: { HP_SAFE: "yes", HP_SECRET: "must-not-leak" },
    environmentAllowlist: ["HP_SAFE"]
  });
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.argv, ["value with spaces", "literal;still-an-argument"]);
  assert.equal(output.safe, "yes");
  assert.equal(output.secret, undefined);
  assert.equal(result.exitCode, 0);
});

test("process runner fails closed on timeout and bounded-output overflow", async () => {
  await assert.rejects(
    runProcess({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 5000)"],
      timeoutMs: 25
    }),
    /timed out/
  );
  await assert.rejects(
    runProcess({
      command: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(1024))"],
      maxOutputBytes: 64
    }),
    /output limit/
  );
});

test("process runner redacts configured secrets from failures", async () => {
  const secret = "token-value-that-must-not-appear";
  await assert.rejects(
    runProcess({
      command: process.execPath,
      args: ["-e", "process.stderr.write(process.argv[1]); process.exit(7)", secret],
      redact: [secret]
    }),
    (error) => {
      assert.doesNotMatch(error.message, new RegExp(secret));
      assert.match(error.message, /\[REDACTED\]/);
      assert.equal(error.exitCode, 7);
      return true;
    }
  );
});
