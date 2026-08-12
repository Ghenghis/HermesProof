import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("GitLab CI cannot consume untagged shared runners and publishes Pages", async () => {
  const ci = await readFile(path.join(root, ".gitlab-ci.yml"), "utf8");
  assert.doesNotMatch(ci, /^include:/m);
  assert.match(ci, /default:\s*[\s\S]*tags:\s*\n\s*- hermesproof-local/);
  assert.match(ci, /pages:\s*\n\s*publish:\s*public/);
  assert.match(ci, /release\/hp-mha-serena-shippable/);
  assert.match(ci, /npm run docs:check/);
  assert.match(ci, /npm run test:updater/);
  assert.match(ci, /npm test/);
});

test("retained GitLab governance assets are reviewable and never auto-included", async () => {
  const [codeowners, optionalCi, bootstrap, securityPolicy] = await Promise.all([
    readFile(path.join(root, "CODEOWNERS"), "utf8"),
    readFile(path.join(root, ".gitlab", "hermesproof-ultimate.yml"), "utf8"),
    readFile(path.join(root, "docs", "gitlab", "hermesproof-ultimate-bootstrap.md"), "utf8"),
    readFile(path.join(root, "docs", "gitlab", "security-policy-template.yml"), "utf8")
  ]);
  assert.match(codeowners, /^\* @Ghenghis$/m);
  assert.match(codeowners, /^\/src\/ @Ghenghis$/m);
  assert.match(optionalCi, /OPTIONAL TEMPLATE/);
  assert.match(optionalCi, /Jobs\/SAST\.gitlab-ci\.yml/);
  assert.match(bootstrap, /not included automatically/i);
  assert.match(securityPolicy, /HermesProof block critical security findings/);
});
