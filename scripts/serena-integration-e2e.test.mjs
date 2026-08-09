import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SERENA_COMMIT,
  SerenaAdapter
} from "../src/hp-mha-serena/serena-adapter.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("pinned Serena indexes HermesProof TypeScript and exposes no direct mutation tools", async () => {
  const adapter = new SerenaAdapter({ workspaceRoot: repoRoot });
  try {
    const health = await adapter.connect();
    assert.equal(health.ok, true);
    assert.equal(health.commit, SERENA_COMMIT);
    assert.equal(health.catalog_tool_count, 52);
    assert.equal(health.advertised_tool_count, 15);
    assert.equal(health.active_tool_count, 15);
    assert.equal(health.mutation_tools_active.length, 0);
    assert.ok(health.semantic_tools.includes("get_symbols_overview"));
    assert.ok(health.semantic_tools.includes("find_symbol"));
    assert.ok(health.semantic_tools.includes("get_diagnostics_for_symbol"));
    assert.ok(!health.semantic_tools.includes("serena_info"));

    const overview = await adapter.callSemantic("get_symbols_overview", {
      relative_path: "src/server.mjs",
      depth: 0,
      max_answer_chars: 20_000
    });
    assert.equal(overview.ok, true);
    assert.match(String(overview.result), /buildRuntime/u);

    const symbol = await adapter.callSemantic("find_symbol", {
      name_path_pattern: "buildRuntime",
      relative_path: "src/server.mjs",
      include_body: false,
      max_matches: 2,
      max_answer_chars: 10_000
    });
    assert.equal(symbol.ok, true);
    assert.match(String(symbol.result), /buildRuntime/u);

    const diagnostics = await adapter.callSemantic("get_diagnostics_for_symbol", {
      name_path: "buildRuntime",
      reference_file: "src/server.mjs",
      check_symbol_references: false,
      min_severity: 4,
      max_answer_chars: 10_000
    });
    assert.equal(diagnostics.ok, true);
  } finally {
    await adapter.close();
  }
});
