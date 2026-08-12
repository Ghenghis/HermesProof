import assert from "node:assert/strict";
import test from "node:test";

import { evaluateRequiredMcpConnections } from "./mcp-client-health.mjs";

test("live client health requires both HermesProof servers", () => {
  const result = evaluateRequiredMcpConnections([
    "hermes3d-locks: node core.mjs - ✓ Connected",
    "hp-mha-serena: node composite.mjs - ✓ Connected"
  ].join("\n"));
  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.failed, []);
});

test("live client health fails when the composite server is disconnected", () => {
  const result = evaluateRequiredMcpConnections([
    "hermes3d-locks: node core.mjs - ✓ Connected",
    "hp-mha-serena: node composite.mjs - ✗ Failed to connect"
  ].join("\n"));
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.failed, ["hp-mha-serena"]);
});

test("live client health fails when a required server is absent", () => {
  const result = evaluateRequiredMcpConnections(
    "hermes3d-locks: node core.mjs - ✓ Connected"
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ["hp-mha-serena"]);
});
