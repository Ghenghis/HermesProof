import assert from "node:assert/strict";
import test from "node:test";

import {
  REVERSE_ENGINEERING_CAPABILITY_PACK,
  assessReverseEngineeringInventory,
  probeReverseEngineeringInventory
} from "./reverse-engineering-kit.mjs";
import { validateCapabilityPack } from "./capability-packs.mjs";

test("reverse-engineering capability pack is pinned, local, least-privilege, and disabled", () => {
  assert.equal(validateCapabilityPack(REVERSE_ENGINEERING_CAPABILITY_PACK).ok, true);
  assert.equal(REVERSE_ENGINEERING_CAPABILITY_PACK.default_enabled, false);
  assert.equal(REVERSE_ENGINEERING_CAPABILITY_PACK.locality, "local");
  assert.equal(REVERSE_ENGINEERING_CAPABILITY_PACK.permissions.includes("network:internet"), false);
  assert.equal(REVERSE_ENGINEERING_CAPABILITY_PACK.authorization_required, true);
});

test("inventory maps installed tools to safe capabilities without enabling them", () => {
  const report = assessReverseEngineeringInventory({
    ghidra: { present: true, version: "11.3" },
    rizin: { present: false },
    x64dbg: { present: true, version: "2025-08" },
    jadx: { present: true, version: "1.5.2" }
  });
  assert.equal(report.ok, true);
  assert.equal(report.enabled, false);
  assert.equal(report.authorization_required, true);
  assert.deepEqual(report.available_capabilities.sort(), [
    "reverse.android",
    "reverse.debug.windows",
    "reverse.static"
  ]);
});

test("probe uses an injected exact-command probe and preserves disabled policy", async () => {
  const calls = [];
  const report = await probeReverseEngineeringInventory({
    commandProbe: async (name, spec) => {
      calls.push({ name, spec });
      return { present: name === "rizin", version: name === "rizin" ? "0.8.1" : null };
    }
  });
  assert.ok(calls.length >= 8);
  assert.ok(calls.every((call) => Array.isArray(call.spec.args)));
  assert.equal(report.enabled, false);
  assert.deepEqual(report.available_capabilities, ["reverse.static"]);
});
