import test from "node:test";
import assert from "node:assert/strict";

import {
  SERENA_CATALOG,
  SERENA_DEFAULT_DIRECT_TOOLS,
  SERENA_DEFAULT_GUARDED_TOOLS,
  SERENA_JETBRAINS_DIRECT_TOOLS,
  SERENA_JETBRAINS_GUARDED_TOOLS,
  SERENA_OPTIONAL_DIRECT_TOOLS,
  SERENA_OPTIONAL_GUARDED_TOOLS,
  SERENA_QUERY_GUARDED_TOOLS
} from "./serena-catalog.mjs";
import { buildSerenaRuntimePolicy } from "../../scripts/generate-serena-runtime-policy.mjs";

test("pinned Serena catalog covers all 52 executable tools exactly once", () => {
  const groups = [
    SERENA_DEFAULT_DIRECT_TOOLS,
    SERENA_DEFAULT_GUARDED_TOOLS,
    SERENA_OPTIONAL_DIRECT_TOOLS,
    SERENA_OPTIONAL_GUARDED_TOOLS,
    SERENA_QUERY_GUARDED_TOOLS,
    SERENA_JETBRAINS_DIRECT_TOOLS,
    SERENA_JETBRAINS_GUARDED_TOOLS
  ];
  const routed = groups.flat();
  assert.equal(SERENA_CATALOG.length, 52);
  assert.equal(routed.length, 52);
  assert.equal(new Set(routed).size, 52);
  assert.deepEqual([...new Set(routed)].sort(), [...SERENA_CATALOG].sort());
});

test("generated runtime policy carries executable truth and fail-closed routes", () => {
  const policy = buildSerenaRuntimePolicy();
  assert.equal(policy.runtime.version, "1.6.2.dev0");
  assert.equal(policy.inventory.full_catalog_count, 52);
  assert.equal(policy.inventory.desktop_default_count, 29);
  assert.equal(policy.inventory.selected_lsp_direct_count, 15);
  assert.equal(Object.keys(policy.inventory.routes).length, 52);
  assert.equal(policy.enforcement.raw_serena_mutations_active, 0);
  assert.equal(policy.enforcement.fail_closed, true);
  assert.equal(policy.capability_packs.jetbrains.default, false);
});

test("default and selected LSP surfaces stay least privilege", () => {
  assert.equal(SERENA_DEFAULT_DIRECT_TOOLS.length, 14);
  assert.equal(SERENA_DEFAULT_GUARDED_TOOLS.length, 15);
  assert.equal(
    SERENA_DEFAULT_DIRECT_TOOLS.length + SERENA_DEFAULT_GUARDED_TOOLS.length,
    29
  );
  assert.deepEqual(
    [...SERENA_OPTIONAL_DIRECT_TOOLS].sort(),
    ["get_diagnostics_for_symbol"]
  );
  assert.ok(SERENA_OPTIONAL_GUARDED_TOOLS.includes("restart_language_server"));
  assert.ok(SERENA_QUERY_GUARDED_TOOLS.includes("query_project"));
  assert.ok(SERENA_JETBRAINS_DIRECT_TOOLS.includes("serena_info"));
  assert.ok(SERENA_JETBRAINS_GUARDED_TOOLS.includes("jet_brains_debug"));
});
