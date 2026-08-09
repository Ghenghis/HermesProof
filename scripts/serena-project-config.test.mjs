import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSerenaRuntimePolicy } from "./generate-serena-runtime-policy.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("shipped Serena 1.6.2.dev0 config uses languages and TypeScript, never legacy language_servers", async () => {
  const raw = await fs.readFile(path.join(repoRoot, ".serena", "project.yml"), "utf8");
  assert.match(raw, /^languages:\s*$/m);
  assert.match(raw, /^\s*-\s*typescript\s*$/m);
  assert.doesNotMatch(raw, /^language_servers:\s*$/m);
  assert.match(raw, /^read_only:\s*true\s*$/m);
  const policy = buildSerenaRuntimePolicy();
  assert.deepEqual(policy.runtime.languages, ["typescript"]);
  assert.equal("language_servers" in policy.runtime, false);
});
