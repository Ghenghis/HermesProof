import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import {
  classifyAxeResults,
  loadHtmlIntoJsdom,
  runAccessibilityWcagAaGate,
  runAxeOnSitePath
} from "./accessibility-wcag-gate.mjs";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

test("classifyAxeResults: clean axe output -> ok=true", () => {
  const out = classifyAxeResults({
    violations: [],
    incomplete: [],
    passes: [{ id: "html-has-lang" }, { id: "image-alt" }]
  });
  assert.equal(out.ok, true);
  assert.equal(out.blockers.length, 0);
  assert.equal(out.warnings.length, 0);
  assert.equal(out.counts.pass_count, 2);
});

test("classifyAxeResults: critical violation is a blocker", () => {
  const out = classifyAxeResults({
    violations: [
      {
        id: "label",
        impact: "critical",
        help: "Form elements must have labels",
        helpUrl: "x",
        tags: ["wcag2a"],
        nodes: [{ target: ["#name"], html: "<input id=name>" }]
      }
    ],
    incomplete: [],
    passes: []
  });
  assert.equal(out.ok, false);
  assert.equal(out.blockers.length, 1);
  assert.equal(out.blockers[0].id, "label");
  assert.equal(out.blockers[0].impact, "critical");
});

test("classifyAxeResults: serious violation is a blocker", () => {
  const out = classifyAxeResults({
    violations: [{ id: "color-contrast", impact: "serious", nodes: [] }],
    incomplete: [],
    passes: []
  });
  assert.equal(out.ok, false);
  assert.equal(out.blockers.length, 1);
});

test("classifyAxeResults: moderate violation is a warning, not a blocker", () => {
  const out = classifyAxeResults({
    violations: [{ id: "landmark-one-main", impact: "moderate", nodes: [] }],
    incomplete: [],
    passes: []
  });
  assert.equal(out.ok, true);
  assert.equal(out.blockers.length, 0);
  assert.equal(out.warnings.length, 1);
});

test("classifyAxeResults: minor violation is a warning, not a blocker", () => {
  const out = classifyAxeResults({
    violations: [{ id: "region", impact: "minor", nodes: [] }],
    incomplete: [],
    passes: []
  });
  assert.equal(out.ok, true);
  assert.equal(out.warnings.length, 1);
});

test("classifyAxeResults: serious WCAG-AA incomplete is a blocker (Codex audit fix 2026-05-03)", () => {
  // Color-contrast under JSDOM is the canonical case: axe can't measure
  // contrast without a real layout engine, so it returns the rule as
  // "incomplete" with serious impact. Previously this passed silently;
  // now it blocks (with an explicit recommendation to verify in browser).
  const out = classifyAxeResults({
    violations: [],
    incomplete: [{ id: "color-contrast", impact: "serious", tags: ["wcag2aa"], nodes: [] }],
    passes: []
  });
  assert.equal(out.ok, false);
  assert.equal(out.blockers.length, 1);
  assert.equal(out.blockers[0].id, "color-contrast");
  assert.equal(out.blockers[0].kind, "incomplete");
  assert.match(out.blockers[0].block_reason, /browser-backed/);
});

test("classifyAxeResults: minor incomplete is still a warning, not a blocker", () => {
  const out = classifyAxeResults({
    violations: [],
    incomplete: [{ id: "duplicate-id-aria", impact: "minor", tags: ["wcag2aa"], nodes: [] }],
    passes: []
  });
  assert.equal(out.ok, true);
  assert.equal(out.blockers.length, 0);
  assert.equal(out.warnings.length, 1);
  assert.equal(out.warnings[0].kind, "incomplete");
});

test("classifyAxeResults: serious incomplete WITHOUT WCAG-AA tag stays a warning", () => {
  // Best-practice / experimental rules shouldn't block AA conformance.
  const out = classifyAxeResults({
    violations: [],
    incomplete: [{ id: "best-practice-thing", impact: "serious", tags: ["best-practice"], nodes: [] }],
    passes: []
  });
  assert.equal(out.ok, true);
  assert.equal(out.warnings.length, 1);
});

test("classifyAxeResults: blockOnSeriousIncomplete=false reverts to legacy warn-only behavior", () => {
  // Escape hatch for explicit pre-2026-05-03 behavior. Should rarely be used.
  const out = classifyAxeResults(
    {
      violations: [],
      incomplete: [{ id: "color-contrast", impact: "serious", tags: ["wcag2aa"], nodes: [] }],
      passes: []
    },
    { blockOnSeriousIncomplete: false }
  );
  assert.equal(out.ok, true);
  assert.equal(out.warnings.length, 1);
});

test("loadHtmlIntoJsdom: parses a simple HTML string", async () => {
  const sb = await fs.mkdtemp(path.join(os.tmpdir(), "hp-a11y-"));
  try {
    const file = path.join(sb, "index.html");
    await fs.writeFile(
      file,
      "<!doctype html><html lang=en><head><title>T</title></head><body><h1>Hi</h1></body></html>"
    );
    const { document } = await loadHtmlIntoJsdom(file);
    assert.equal(document.querySelector("h1").textContent, "Hi");
  } finally {
    await fs.rm(sb, { recursive: true, force: true });
  }
});

test("runAxeOnSitePath: clean fixture has no critical/serious violations", async () => {
  const sb = await fs.mkdtemp(path.join(os.tmpdir(), "hp-a11y-"));
  try {
    const file = path.join(sb, "index.html");
    await fs.writeFile(
      file,
      `<!doctype html>
       <html lang="en">
       <head><meta charset="utf-8"><title>Clean</title></head>
       <body>
         <main>
           <h1>Hello</h1>
           <p>World</p>
         </main>
       </body></html>`
    );
    const r = await runAxeOnSitePath(file);
    const critOrSerious = (r.violations || []).filter(
      (v) => v.impact === "critical" || v.impact === "serious"
    );
    assert.equal(critOrSerious.length, 0, JSON.stringify(critOrSerious, null, 2));
  } finally {
    await fs.rm(sb, { recursive: true, force: true });
  }
});

test("runAxeOnSitePath: page missing <html lang> raises a violation", async () => {
  const sb = await fs.mkdtemp(path.join(os.tmpdir(), "hp-a11y-"));
  try {
    const file = path.join(sb, "index.html");
    await fs.writeFile(
      file,
      `<!doctype html>
       <html>
       <head><meta charset="utf-8"><title>NoLang</title></head>
       <body><main><h1>Hi</h1></main></body></html>`
    );
    const r = await runAxeOnSitePath(file);
    const ids = (r.violations || []).map((v) => v.id);
    // axe-core emits "html-has-lang" (critical). If axe ever renames, this
    // test should still find SOMETHING because the page has no lang attr.
    assert.ok(
      ids.includes("html-has-lang") || ids.length > 0,
      `expected at least one violation; got: ${JSON.stringify(ids)}`
    );
  } finally {
    await fs.rm(sb, { recursive: true, force: true });
  }
});

test("runAccessibilityWcagAaGate: image without alt -> blocker", async () => {
  const sb = await fs.mkdtemp(path.join(os.tmpdir(), "hp-a11y-"));
  try {
    const file = path.join(sb, "index.html");
    await fs.writeFile(
      file,
      `<!doctype html>
       <html lang="en">
       <head><meta charset="utf-8"><title>BadImg</title></head>
       <body><main><h1>Hi</h1><img src="x.png"></main></body></html>`
    );
    const r = await runAccessibilityWcagAaGate({ htmlPath: file });
    assert.equal(r.ok, false);
    const ids = r.evidence.blockers.map((b) => b.id);
    assert.ok(ids.includes("image-alt"), `expected image-alt blocker; got ${ids.join(",")}`);
  } finally {
    await fs.rm(sb, { recursive: true, force: true });
  }
});

test("runAccessibilityWcagAaGate: malformed path returns ok=false with error evidence", async () => {
  const r = await runAccessibilityWcagAaGate({ htmlPath: "/no/such/file/exists.html" });
  assert.equal(r.ok, false);
  assert.match(r.details, /accessibility scan failed/);
  assert.ok(r.evidence.error);
});

test("runAccessibilityWcagAaGate: real site/index.html passes WCAG 2.1 AA", async () => {
  const sitePath = path.join(repoRoot, "site", "index.html");
  try {
    await fs.access(sitePath);
  } catch {
    return; // CI may run this in a stripped checkout
  }
  const r = await runAccessibilityWcagAaGate({ htmlPath: sitePath });
  if (!r.ok) {
    const lines = r.evidence.blockers
      .map((b) => `  ${b.id} (${b.impact}): ${b.help}`)
      .join("\n");
    assert.fail(
      `site/index.html has blocking WCAG AA violations:\n${lines}\nSee evidence.blockers for details.`
    );
  }
  assert.equal(r.ok, true);
  // The marketing site should land on a non-trivial pass count, otherwise
  // axe almost certainly didn't actually scan anything.
  assert.ok(
    r.evidence.counts.pass_count > 5,
    `axe pass_count suspiciously low: ${r.evidence.counts.pass_count}`
  );
});
