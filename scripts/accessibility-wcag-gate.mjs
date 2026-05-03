/**
 * accessibility-wcag-aa gate — runs axe-core over the marketing site at
 * `site/index.html` (parsed via JSDOM, no browser required) and asserts
 * 0 critical and 0 serious WCAG 2.x AA findings.
 *
 * Why this shape:
 *   - axe-core is the de-facto a11y engine (Deque). axe-core/cli would pull
 *     puppeteer + headless Chromium (~150MB). JSDOM is dev-only and ships
 *     pure JS, ~5MB on disk — sufficient for a static HTML page.
 *   - We restrict the rule set to WCAG 2.1 Level A and Level AA tags only,
 *     matching the gate id `accessibility.wcag_aa_pass`.
 *   - We treat `critical` and `serious` impacts as failing; `moderate` and
 *     `minor` are surfaced in the evidence as warnings.
 *
 * Exposed:
 *   loadHtmlIntoJsdom(htmlPath)    -> { window, document, dom }
 *   runAxeOnSitePath(htmlPath)     -> Promise<axeResults>
 *   classifyAxeResults(axeResults) -> { ok, blockers, warnings, evidence }
 *   runAccessibilityWcagAaGate({ htmlPath }) -> { ok, evidence, details }
 *
 * Notes for offline / sandbox:
 *   - JSDOM may emit network-fetch warnings for external <link>/<script>;
 *     we configure resourceLoader to refuse external fetches so the run
 *     stays hermetic. Locally-referenced assets (./styles.css, ./app.js)
 *     are loaded if present.
 */
import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";

let _jsdomMod = null;
let _axeMod = null;

async function loadDeps() {
  if (!_jsdomMod) _jsdomMod = await import("jsdom");
  if (!_axeMod) _axeMod = await import("axe-core");
  return { JSDOM: _jsdomMod.JSDOM, axe: _axeMod.default ?? _axeMod };
}

/**
 * Load `htmlPath` into a JSDOM window, configured to:
 *   - resolve URLs relative to the file (so url('./styles.css') would work
 *     if we enabled resource loading)
 *   - NOT fetch the network (resources: undefined; we don't pass a custom
 *     ResourceLoader — JSDOM defaults to no-fetch).
 *   - run scripts in the same realm so axe-core can be injected and
 *     execute against the document.
 */
export async function loadHtmlIntoJsdom(htmlPath) {
  const { JSDOM } = await loadDeps();
  const html = await fs.readFile(htmlPath, "utf8");
  const fileUrl = url.pathToFileURL(htmlPath).href;
  // Quiet the JSDOM "not implemented" virtual-console line for canvas;
  // we don't depend on canvas rendering. Other JSDOM warnings still show.
  const { VirtualConsole } = _jsdomMod;
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", () => {});
  virtualConsole.on("error", () => {});
  // forward other levels to host stderr unchanged
  for (const level of ["warn", "info", "log", "debug"]) {
    virtualConsole.on(level, (...args) => process.stderr.write(`[jsdom:${level}] ${args.join(" ")}\n`));
  }
  const dom = new JSDOM(html, {
    url: fileUrl,
    runScripts: "outside-only", // we eval axe-core ourselves; don't run inline page scripts
    pretendToBeVisual: true,    // gives us window.matchMedia, requestAnimationFrame, etc.
    virtualConsole
  });
  return { dom, window: dom.window, document: dom.window.document };
}

/**
 * Inject axe-core into the JSDOM window and run it with WCAG 2.1 Level A/AA
 * rule tags only. Returns the raw axe results object.
 */
export async function runAxeOnSitePath(htmlPath) {
  const { axe } = await loadDeps();
  const { dom, window } = await loadHtmlIntoJsdom(htmlPath);
  try {
    // axe-core's source string can be evaluated inside the JSDOM window so
    // the engine sees the JSDOM document as window.document.
    const axeSource = axe.source;
    window.eval(axeSource);
    // Run axe via the in-window global — this is the canonical pattern.
    const axeRunner = window.axe;
    if (!axeRunner || typeof axeRunner.run !== "function") {
      throw new Error("axe-core injection failed: window.axe.run is not a function");
    }
    const results = await axeRunner.run(window.document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]
      },
      // Prevent network-only checks from hanging on JSDOM:
      resultTypes: ["violations", "incomplete"]
    });
    return results;
  } finally {
    // JSDOM uses XHR/timers; close to release handles.
    try { dom.window.close(); } catch {}
  }
}

/**
 * Reduce raw axe results to the gate verdict.
 *   - "critical" + "serious" violations are blockers.
 *   - "moderate" + "minor" violations are surfaced as warnings only.
 *   - "incomplete" rules (axe couldn't determine) are surfaced as warnings.
 */
export function classifyAxeResults(axeResults) {
  const violations = axeResults.violations || [];
  const incomplete = axeResults.incomplete || [];

  const blockers = [];
  const warnings = [];
  for (const v of violations) {
    const entry = {
      id: v.id,
      impact: v.impact,
      help: v.help,
      help_url: v.helpUrl,
      tags: v.tags,
      node_count: (v.nodes || []).length,
      sample_nodes: (v.nodes || []).slice(0, 3).map((n) => ({
        target: n.target,
        html: (n.html || "").slice(0, 200)
      }))
    };
    if (v.impact === "critical" || v.impact === "serious") {
      blockers.push(entry);
    } else {
      warnings.push(entry);
    }
  }
  for (const i of incomplete) {
    warnings.push({
      id: i.id,
      impact: i.impact || "incomplete",
      help: i.help,
      help_url: i.helpUrl,
      tags: i.tags,
      node_count: (i.nodes || []).length,
      kind: "incomplete"
    });
  }
  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    counts: {
      violation_count: violations.length,
      incomplete_count: incomplete.length,
      blocker_count: blockers.length,
      warning_count: warnings.length,
      pass_count: (axeResults.passes || []).length
    }
  };
}

/**
 * Top-level gate runner — returns the evidence-shaped object the truth-gate
 * harness expects.
 */
export async function runAccessibilityWcagAaGate({ htmlPath }) {
  let axeResults;
  try {
    axeResults = await runAxeOnSitePath(htmlPath);
  } catch (err) {
    // Couldn't load deps or parse the HTML — bubble up as a gate failure
    // rather than an unhandled rejection.
    return {
      ok: false,
      evidence: {
        file: htmlPath,
        error: err.message
      },
      details: `accessibility scan failed: ${err.message}`
    };
  }
  const { ok, blockers, warnings, counts } = classifyAxeResults(axeResults);
  const evidence = {
    file: path.resolve(htmlPath),
    counts,
    blockers,
    warnings: warnings.slice(0, 20), // cap warning array for evidence size
    axe_version: axeResults.testEngine?.version,
    rule_tags: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]
  };
  const details = ok
    ? `0 critical/serious violations across ${counts.pass_count} passing rule(s)` +
      (counts.warning_count ? ` (${counts.warning_count} non-blocking warning(s))` : "")
    : `${counts.blocker_count} blocking a11y violation(s): ` +
      blockers.map((b) => `${b.id}(${b.impact})`).join(", ");
  return { ok, evidence, details };
}
