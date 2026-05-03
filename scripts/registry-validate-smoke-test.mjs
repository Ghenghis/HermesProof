import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  parseYamlSubset,
  parseCsv,
  runProviderRegistryValidate,
  runLocalModelsCatalogValidate,
  runContinueLlmClassesValidate,
  runKilocodeProviderMappingValidate,
  EXPECTED_CONTINUE_PROVIDER_NAMES
} from "./provider-registry-validate.mjs";
import {
  probeUrl,
  runLmstudioHealth,
  runOllamaHealth
} from "./local-providers-health.mjs";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repoRoot = path.resolve(here, "..");
const REGISTRY_DIR = path.join(repoRoot, "policies", "provider-registry");

// ---------------------------------------------------------------------------
// YAML subset parser
// ---------------------------------------------------------------------------
test("parseYamlSubset — flat scalar map", () => {
  const out = parseYamlSubset(`schema: v1\ncount: 42\nflag: true\n`);
  assert.deepEqual(out, { schema: "v1", count: 42, flag: true });
});

test("parseYamlSubset — nested mapping", () => {
  const yaml = [
    "routing:",
    "  local_private:",
    "    default: lmstudio",
    "    fallback: ollama",
    "  hybrid:",
    "    architect: claude"
  ].join("\n") + "\n";
  const out = parseYamlSubset(yaml);
  assert.equal(out.routing.local_private.default, "lmstudio");
  assert.equal(out.routing.local_private.fallback, "ollama");
  assert.equal(out.routing.hybrid.architect, "claude");
});

test("parseYamlSubset — sequence of mappings", () => {
  const yaml = [
    "providers:",
    "- name: a",
    "  url: u-a",
    "- name: b",
    "  url: u-b"
  ].join("\n") + "\n";
  const out = parseYamlSubset(yaml);
  assert.equal(out.providers.length, 2);
  assert.equal(out.providers[0].name, "a");
  assert.equal(out.providers[1].url, "u-b");
});

// ---------------------------------------------------------------------------
// CSV parser
// ---------------------------------------------------------------------------
test("parseCsv — happy path", () => {
  const out = parseCsv("a,b,c\n1,2,3\n4,5,6\n");
  assert.deepEqual(out.header, ["a", "b", "c"]);
  assert.equal(out.rows.length, 2);
  assert.equal(out.rows[0].b, "2");
  assert.equal(out.skipped.length, 0);
});

test("parseCsv — skips quoted-comma rows", () => {
  const out = parseCsv("a,b\n1,\"x,y\"\n2,3\n");
  assert.equal(out.skipped.length, 1);
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].a, "2");
});

test("parseCsv — skips column-mismatch rows", () => {
  const out = parseCsv("a,b,c\n1,2,3\n4,5\n6,7,8\n");
  assert.equal(out.rows.length, 2);
  assert.equal(out.skipped.length, 1);
  assert.equal(out.skipped[0].line_no, 3);
});

// ---------------------------------------------------------------------------
// provider.registry.validate
// ---------------------------------------------------------------------------
test("provider.registry.validate — passes against shipped registry.yaml", async () => {
  const r = await runProviderRegistryValidate({ registryDir: REGISTRY_DIR });
  assert.equal(r.ok, true, `findings: ${JSON.stringify(r.findings, null, 2)}`);
  assert.ok(r.evidence.class_count >= 62, `expected >=62 classes, got ${r.evidence.class_count}`);
  assert.equal(r.evidence.unique_provider_names, r.evidence.class_count);
});

test("provider.registry.validate — fails on duplicate provider_name", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "prv-reg-dup-"));
  try {
    await fs.writeFile(path.join(tmp, "registry.yaml"), [
      "schema: hermes.provider_completeness.v1",
      "continue_llm_classes:",
      "- class: A",
      "  provider_name: dup",
      "  source_path: x.ts",
      "- class: B",
      "  provider_name: dup",
      "  source_path: y.ts"
    ].join("\n") + "\n", "utf8");
    const r = await runProviderRegistryValidate({ registryDir: tmp });
    assert.equal(r.ok, false);
    assert.ok(r.findings.some((f) => f.kind === "duplicate_provider_name"));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("provider.registry.validate — fails on schema mismatch", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "prv-reg-schema-"));
  try {
    await fs.writeFile(path.join(tmp, "registry.yaml"), [
      "schema: bogus.v0",
      "continue_llm_classes:",
      "- class: A",
      "  provider_name: a",
      "  source_path: x.ts"
    ].join("\n") + "\n", "utf8");
    const r = await runProviderRegistryValidate({ registryDir: tmp });
    assert.equal(r.ok, false);
    assert.ok(r.findings.some((f) => f.kind === "schema_mismatch"));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("provider.registry.validate — fails on missing required field", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "prv-reg-missing-"));
  try {
    await fs.writeFile(path.join(tmp, "registry.yaml"), [
      "schema: hermes.provider_completeness.v1",
      "continue_llm_classes:",
      "- class: NoName",
      "  source_path: x.ts"
    ].join("\n") + "\n", "utf8");
    const r = await runProviderRegistryValidate({ registryDir: tmp });
    assert.equal(r.ok, false);
    assert.ok(r.findings.some((f) => f.kind === "missing_field" && f.field === "provider_name"));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// local.models.catalog.validate
// ---------------------------------------------------------------------------
test("local.models.catalog.validate — passes against shipped CSV", async () => {
  const r = await runLocalModelsCatalogValidate({ registryDir: REGISTRY_DIR });
  assert.equal(r.ok, true, `details: ${r.details}`);
  assert.ok(r.evidence.row_count >= 80, `expected ~87 rows, got ${r.evidence.row_count}`);
});

test("local.models.catalog.validate — fails when required column missing", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lms-bad-"));
  try {
    await fs.writeFile(path.join(tmp, "lmstudio_local_models.csv"),
      "device,arch,params,publisher,model_id,quant,size\nLM,Q,4B,me,foo,Q4,1G\n", "utf8");
    const r = await runLocalModelsCatalogValidate({ registryDir: tmp });
    assert.equal(r.ok, false);
    assert.ok(r.findings.some((f) => f.kind === "missing_column" && f.column === "modified"));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("local.models.catalog.validate — every row has exactly 8 columns (Codex audit, PR #32)", async () => {
  // Codex's read-only audit on PR #32 (2026-05-03) found field-shifted
  // rows in lmstudio_local_models.csv where a spurious 'Local' field had
  // been inserted, pushing model_id into the quant column. The fix
  // strips 'Local' and back-derives quant from the model_id filename.
  // This invariant test prevents regressions: every data row must have
  // exactly 8 columns matching the header.
  const text = await fs.readFile(path.join(REGISTRY_DIR, "lmstudio_local_models.csv"), "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const headerCols = lines[0].split(",").length;
  assert.equal(headerCols, 8, "header must declare 8 columns");
  for (let i = 1; i < lines.length; i++) {
    // Naive split — registry CSV is generated to be comma-clean by convention
    const cols = lines[i].split(",").length;
    assert.equal(cols, 8, `row ${i + 1} has ${cols} columns (expected 8): ${lines[i].slice(0, 100)}`);
  }
});

// ---------------------------------------------------------------------------
// continue.llm_classes.validate
// ---------------------------------------------------------------------------
test("continue.llm_classes.validate — all 62 expected names present", async () => {
  const r = await runContinueLlmClassesValidate({ registryDir: REGISTRY_DIR });
  assert.equal(r.ok, true, `missing: ${r.evidence.missing.join(",")}`);
  assert.equal(r.evidence.expected_count, 62);
});

test("continue.llm_classes.validate — fails when a known name is removed", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "csv-bad-"));
  try {
    // Only include 1 of the 62 expected names.
    await fs.writeFile(path.join(tmp, "continue_llm_classes.csv"),
      "class,provider_name,source_path,default_model\nAnthropic,anthropic,llms/Anthropic.ts,\n", "utf8");
    const r = await runContinueLlmClassesValidate({ registryDir: tmp });
    assert.equal(r.ok, false);
    assert.ok(r.evidence.missing.length === EXPECTED_CONTINUE_PROVIDER_NAMES.length - 1);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// kilocode.provider.mapping.validate (stub)
// ---------------------------------------------------------------------------
test("kilocode.provider.mapping.validate — stub returns not_applicable", async () => {
  const r = await runKilocodeProviderMappingValidate({ registryDir: REGISTRY_DIR });
  assert.equal(r.ok, true);
  assert.equal(r.status, "not_applicable");
});

// ---------------------------------------------------------------------------
// health probes — unreachable-port WARN semantics
// ---------------------------------------------------------------------------
test("probeUrl — bogus URL returns ok:false (not throw)", async () => {
  const out = await probeUrl("http://localhost:1/__definitely_not_a_server", { timeoutMs: 500 });
  assert.equal(out.ok, false);
  assert.ok(typeof out.error === "string" || out.status === 0);
});

test("lmstudio.health — offline becomes warn-level pass-through", async () => {
  const r = await runLmstudioHealth({
    baseUrl: "http://localhost:1/__nope",
    timeoutMs: 500
  });
  assert.equal(r.level, "warn");
  // Whether ok or not, the gate must still return a structured record.
  assert.ok(typeof r.evidence.base_url === "string");
});

test("ollama.health — offline becomes warn-level pass-through", async () => {
  const r = await runOllamaHealth({
    baseUrl: "http://localhost:1/__nope",
    timeoutMs: 500
  });
  assert.equal(r.level, "warn");
  assert.ok(typeof r.evidence.base_url === "string");
});

// ---------------------------------------------------------------------------
// routing.yaml file is present (sanity)
// ---------------------------------------------------------------------------
test("routing.yaml — present and parseable, schema=hermes.routing.v1", async () => {
  const p = path.join(REGISTRY_DIR, "routing.yaml");
  const raw = await fs.readFile(p, "utf8");
  const parsed = parseYamlSubset(raw);
  assert.equal(parsed.schema, "hermes.routing.v1");
  assert.equal(parsed.local_private.default, "lmstudio");
  assert.equal(parsed.local_private.fallback, "ollama");
  assert.equal(parsed.hybrid.architect, "anthropic/claude");
  assert.equal(parsed.hybrid.implementation, "minimax");
  assert.equal(parsed.hybrid.budget_implementation, "deepseek");
  assert.equal(parsed.hybrid.fallback, "siliconflow");
});
