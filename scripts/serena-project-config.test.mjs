import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSerenaRuntimePolicy } from "./generate-serena-runtime-policy.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("shipped Serena 1.6.2.dev0 config uses language_servers and TypeScript, never legacy languages", async () => {
  const raw = await fs.readFile(path.join(repoRoot, ".serena", "project.yml"), "utf8");
  assert.match(raw, /^language_servers:\s*$/m);
  assert.match(raw, /^\s*-\s*typescript\s*$/m);
  assert.doesNotMatch(raw, /^languages:\s*$/m);
  assert.match(raw, /^read_only:\s*true\s*$/m);
  const policy = buildSerenaRuntimePolicy();
  assert.deepEqual(policy.runtime.language_servers, ["typescript"]);
  assert.equal("languages" in policy.runtime, false);
});
