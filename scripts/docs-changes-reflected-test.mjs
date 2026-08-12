import test from "node:test";
import assert from "node:assert/strict";
import {
  parseNameStatus,
  detectVersionBump,
  pickAdrChanges,
  extractAddedLines,
  checkReflected
} from "./docs-changes-reflected.mjs";

test("parseNameStatus extracts (status, path) for M/A/D and rename destinations", () => {
  const text = [
    "M\tpackage.json",
    "A\tdocs/adr/0007-thing.md",
    "D\tdocs/old.md",
    "R100\tREADME.old.md\tREADME.md"
  ].join("\n");
  const out = parseNameStatus(text);
  assert.deepEqual(out, [
    { status: "M", path: "package.json" },
    { status: "A", path: "docs/adr/0007-thing.md" },
    { status: "D", path: "docs/old.md" },
    { status: "R", path: "README.md" }
  ]);
});

test("detectVersionBump finds old/new version pairs in package.json diff", () => {
  const diff = [
    'diff --git a/package.json b/package.json',
    '--- a/package.json',
    '+++ b/package.json',
    '@@ -1,5 +1,5 @@',
    ' {',
    '   "name": "hermesproof",',
    '-  "version": "0.5.0",',
    '+  "version": "0.6.0",',
    '   "private": true'
  ].join("\n");
  const r = detectVersionBump(diff);
  assert.equal(r.changed, true);
  assert.equal(r.oldVersion, "0.5.0");
  assert.equal(r.newVersion, "0.6.0");
});

test("detectVersionBump returns changed=false when version unchanged", () => {
  const diff = [
    '-  "description": "foo"',
    '+  "description": "bar"'
  ].join("\n");
  const r = detectVersionBump(diff);
  assert.equal(r.changed, false);
});

test("pickAdrChanges recognises common ADR conventions", () => {
  const changes = [
    { status: "A", path: "docs/adr/0007-evidence-chain.md" },
    { status: "M", path: "adr/ADR-0001.md" },
    { status: "A", path: "docs/architecture/decisions/0042-foo.md" },
    { status: "M", path: "docs/adr-001-bar.md" },
    { status: "M", path: "src/server.mjs" },
    { status: "A", path: "README.md" }
  ];
  const adrs = pickAdrChanges(changes);
  assert.equal(adrs.length, 4);
  assert.deepEqual(
    adrs.map((c) => c.path).sort(),
    [
      "adr/ADR-0001.md",
      "docs/adr-001-bar.md",
      "docs/adr/0007-evidence-chain.md",
      "docs/architecture/decisions/0042-foo.md"
    ]
  );
});

test("extractAddedLines returns content of '+' lines without the prefix", () => {
  const diff = [
    '@@ -1,2 +1,4 @@',
    ' kept line',
    '+## v0.6.0',
    '+  - feature x',
    '-removed'
  ].join("\n");
  assert.deepEqual(extractAddedLines(diff), ["## v0.6.0", "  - feature x"]);
});

test("checkReflected: version bump satisfied by changelog mention", () => {
  const triggers = [{ kind: "version", from: "0.5.0", to: "0.6.0" }];
  const docs = {
    readmeAdded: [],
    changelogAdded: ["## 0.6.0 — 2026-05-03"]
  };
  const unreflected = checkReflected(triggers, docs);
  assert.deepEqual(unreflected, []);
});

test("checkReflected: version bump unreflected when no docs mention new version", () => {
  const triggers = [{ kind: "version", from: "0.5.0", to: "0.6.0" }];
  const docs = {
    readmeAdded: ["minor wording fix"],
    changelogAdded: ["unrelated"]
  };
  const unreflected = checkReflected(triggers, docs);
  assert.equal(unreflected.length, 1);
  assert.equal(unreflected[0].kind, "version");
  assert.equal(unreflected[0].to, "0.6.0");
});

test("checkReflected: ADR satisfied by README mention of basename", () => {
  const triggers = [{ kind: "adr", path: "docs/adr/0007-evidence-chain.md" }];
  const docs = {
    readmeAdded: ["See docs/adr/0007-evidence-chain.md for the new chain protocol."],
    changelogAdded: []
  };
  const unreflected = checkReflected(triggers, docs);
  assert.deepEqual(unreflected, []);
});

test("checkReflected: ADR unreflected when README/CHANGELOG do not mention it", () => {
  const triggers = [{ kind: "adr", path: "docs/adr/0007-evidence-chain.md" }];
  const docs = { readmeAdded: ["unrelated"], changelogAdded: [] };
  const unreflected = checkReflected(triggers, docs);
  assert.equal(unreflected.length, 1);
  assert.equal(unreflected[0].kind, "adr");
});
