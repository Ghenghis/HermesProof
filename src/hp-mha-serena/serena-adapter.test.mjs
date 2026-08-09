import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  SERENA_COMMIT,
  SERENA_DIRECT_TOOLS,
  SERENA_GUARDED_TOOLS,
  SERENA_SOURCE,
  SERENA_VERSION,
  SerenaAdapter,
  SerenaAdapterError
} from "./serena-adapter.mjs";

test("Serena capability routes cover the current 29-tool catalog exactly once", () => {
  const routed = [...SERENA_DIRECT_TOOLS, ...SERENA_GUARDED_TOOLS];
  assert.equal(SERENA_DIRECT_TOOLS.length, 14);
  assert.equal(SERENA_GUARDED_TOOLS.length, 15);
  assert.equal(routed.length, 29);
  assert.equal(new Set(routed).size, 29);
  assert.ok(SERENA_GUARDED_TOOLS.includes("activate_project"));
  assert.ok(SERENA_GUARDED_TOOLS.includes("edit_memory"));
  assert.ok(SERENA_GUARDED_TOOLS.includes("execute_shell_command"));
});

function fakeClient({ tools, result = { content: [{ type: "text", text: "ok" }] } }) {
  const calls = [];
  const configText = [
    "Current configuration:",
    "Language server status: ready",
    "Active tools (after all exclusions from the project, context, and modes):",
    "  " + tools.join(", "),
    "Available but not active tools:",
    "  none"
  ].join("\n");
  return {
    calls,
    async connect() {},
    async listTools() {
      return { tools: tools.map((name) => ({ name })) };
    },
    async callTool(request) {
      calls.push(request);
      if (request.name === "get_current_config") {
        return {
          structuredContent: { result: configText },
          content: [{ type: "text", text: configText }]
        };
      }
      return result;
    },
    async close() {}
  };
}

test("Serena runtime is immutable and semantic calls use the configured project", async () => {
  const client = fakeClient({
    tools: ["get_symbols_overview", "find_symbol", "get_diagnostics_for_file"]
  });
  let launch;
  const adapter = new SerenaAdapter({
    workspaceRoot: path.resolve("fixture"),
    serenaHome: path.resolve("fixture-serena-home"),
    clientFactory: async (options) => {
      launch = options;
      return client;
    }
  });

  const health = await adapter.connect();
  assert.equal(SERENA_VERSION, "1.6.2.dev0");
  assert.equal(SERENA_COMMIT, "430fc62e72d3a82059b870560e4a2ea60bbb9cf5");
  assert.match(SERENA_SOURCE, new RegExp(SERENA_COMMIT + "$"));
  assert.equal(health.ok, true);
  assert.equal(health.mutation_tools_active.length, 0);
  assert.ok(launch.args.includes(path.resolve("fixture")));
  assert.ok(launch.args.includes(SERENA_SOURCE));
  assert.equal(launch.env.SERENA_HOME, path.resolve("fixture-serena-home"));
  assert.ok(launch.args.includes(path.join(
    path.resolve("fixture"),
    ".serena",
    "hermesproof-context.yml"
  )));

  const overview = await adapter.callSemantic("get_symbols_overview", {
    relative_path: "src/server.mjs",
    depth: 0
  });
  assert.equal(overview.ok, true);
  assert.equal(client.calls[1].name, "get_symbols_overview");
});

test("adapter refuses direct Serena mutation or shell capabilities", async () => {
  const exposed = fakeClient({
    tools: ["get_symbols_overview", "create_text_file", "execute_shell_command"]
  });
  const adapter = new SerenaAdapter({
    workspaceRoot: path.resolve("fixture"),
    clientFactory: async () => exposed
  });

  await assert.rejects(
    adapter.connect(),
    (error) => error instanceof SerenaAdapterError && error.code === "SERENA_MUTATION_ACTIVE"
  );

  const safe = new SerenaAdapter({
    workspaceRoot: path.resolve("fixture"),
    clientFactory: async () => fakeClient({ tools: ["get_symbols_overview"] })
  });
  await safe.connect();
  await assert.rejects(
    safe.callSemantic("create_text_file", {
      relative_path: "bad.txt",
      content: "bad"
    }),
    (error) => error instanceof SerenaAdapterError && error.code === "SERENA_TOOL_DENIED"
  );
});
