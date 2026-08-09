import path from "node:path";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import {
  SERENA_CATALOG,
  SERENA_COMMIT,
  SERENA_DEFAULT_DIRECT_TOOLS,
  SERENA_DEFAULT_GUARDED_TOOLS,
  SERENA_JETBRAINS_GUARDED_TOOLS,
  SERENA_OPTIONAL_DIRECT_TOOLS,
  SERENA_OPTIONAL_GUARDED_TOOLS,
  SERENA_QUERY_GUARDED_TOOLS,
  SERENA_SELECTED_LSP_TOOLS,
  SERENA_SOURCE,
  SERENA_VERSION
} from "./serena-catalog.mjs";

export {
  SERENA_COMMIT,
  SERENA_DEFAULT_DIRECT_TOOLS as SERENA_DIRECT_TOOLS,
  SERENA_DEFAULT_GUARDED_TOOLS as SERENA_GUARDED_TOOLS,
  SERENA_SOURCE,
  SERENA_VERSION
};

const SEMANTIC_TOOLS = new Set(SERENA_SELECTED_LSP_TOOLS);
const MUTATION_TOOLS = new Set([
  ...SERENA_DEFAULT_GUARDED_TOOLS,
  ...SERENA_OPTIONAL_GUARDED_TOOLS,
  ...SERENA_QUERY_GUARDED_TOOLS,
  ...SERENA_JETBRAINS_GUARDED_TOOLS
]);

export class SerenaAdapterError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "SerenaAdapterError";
    this.code = code;
    this.details = details;
  }
}

async function defaultClientFactory({ command, args, cwd, env }) {
  const client = new Client({
    name: "hp-mha-serena-adapter",
    version: "0.8.0"
  });
  const transport = new StdioClientTransport({
    command,
    args,
    cwd,
    env,
    stderr: "pipe"
  });
  return {
    async connect() {
      await client.connect(transport);
    },
    async listTools() {
      return client.listTools();
    },
    async callTool(request) {
      return client.callTool(request);
    },
    async close() {
      await client.close();
    }
  };
}

function parseActiveTools(configText) {
  const startMarker = "Active tools (after all exclusions from the project, context, and modes):";
  const endMarker = "Available but not active tools:";
  const start = configText.indexOf(startMarker);
  const end = configText.indexOf(endMarker);
  if (start < 0 || end <= start) {
    throw new SerenaAdapterError(
      "SERENA_CONFIG_UNVERIFIED",
      "Serena did not report its active tool set"
    );
  }
  return new Set(
    configText
      .slice(start + startMarker.length, end)
      .split(/[,\r\n]+/u)
      .map((name) => name.trim())
      .filter(Boolean)
  );
}

export class SerenaAdapter {
  constructor({
    workspaceRoot,
    uvxCommand = process.env.HERMES_SERENA_UVX || "uvx",
    clientFactory = defaultClientFactory
  } = {}) {
    if (typeof workspaceRoot !== "string" || workspaceRoot.trim().length === 0) {
      throw new TypeError("workspaceRoot is required");
    }
    if (typeof clientFactory !== "function") {
      throw new TypeError("clientFactory must be a function");
    }
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.uvxCommand = uvxCommand;
    this.clientFactory = clientFactory;
    this.client = null;
    this.tools = new Set();
    this.activeTools = new Set();
    this.currentConfig = "";
  }

  launchOptions() {
    return {
      command: this.uvxCommand,
      args: [
        "--from",
        SERENA_SOURCE,
        "serena",
        "start-mcp-server",
        "--project",
        this.workspaceRoot,
        "--context",
        path.join(this.workspaceRoot, ".serena", "hermesproof-context.yml"),
        "--transport",
        "stdio",
        "--enable-web-dashboard",
        "False",
        "--open-web-dashboard",
        "False",
        "--enable-gui-log-window",
        "False",
        "--log-level",
        "WARNING"
      ],
      cwd: this.workspaceRoot,
      env: {
        ...process.env,
        SERENA_USAGE_REPORTING: "false",
        PYTHONUTF8: "1"
      }
    };
  }

  async connect() {
    if (this.client) {
      return this.health();
    }
    const client = await this.clientFactory(this.launchOptions());
    try {
      await client.connect();
      const listed = await client.listTools();
      this.tools = new Set((listed.tools ?? []).map((tool) => tool.name));

      const configResult = await client.callTool({
        name: "get_current_config",
        arguments: {}
      });
      if (configResult?.isError) {
        throw new SerenaAdapterError(
          "SERENA_CONFIG_UNVERIFIED",
          "Serena failed to report its active configuration"
        );
      }
      this.currentConfig = configResult?.structuredContent?.result ??
        (configResult?.content ?? [])
          .filter((item) => item.type === "text")
          .map((item) => item.text)
          .join("\n");
      this.activeTools = parseActiveTools(String(this.currentConfig));
      if (!String(this.currentConfig).includes("Language server status: ready")) {
        throw new SerenaAdapterError(
          "SERENA_LANGUAGE_SERVER_NOT_READY",
          "Serena language server is not ready"
        );
      }

      const activeMutationTools = [...MUTATION_TOOLS]
        .filter((name) => this.activeTools.has(name))
        .sort();
      if (activeMutationTools.length > 0) {
        throw new SerenaAdapterError(
          "SERENA_MUTATION_ACTIVE",
          "Direct Serena mutation or shell tools are active",
          { tools: activeMutationTools }
        );
      }
      this.client = client;
      return this.health();
    } catch (error) {
      await client.close().catch(() => {});
      this.tools = new Set();
      this.activeTools = new Set();
      this.currentConfig = "";
      if (error instanceof SerenaAdapterError) {
        throw error;
      }
      throw new SerenaAdapterError(
        "SERENA_CONNECT_FAILED",
        "Unable to connect to pinned Serena",
        { cause: error?.message ?? String(error) }
      );
    }
  }

  health() {
    const mutationToolsAdvertised = [...MUTATION_TOOLS]
      .filter((name) => this.tools.has(name))
      .sort();
    const mutationToolsActive = [...MUTATION_TOOLS]
      .filter((name) => this.activeTools.has(name))
      .sort();
    const semanticTools = [...SEMANTIC_TOOLS]
      .filter((name) => this.activeTools.has(name))
      .sort();
    return {
      ok: Boolean(this.client) &&
        mutationToolsActive.length === 0 &&
        semanticTools.length > 0,
      version: SERENA_VERSION,
      commit: SERENA_COMMIT,
      source: SERENA_SOURCE,
      workspace_root: this.workspaceRoot,
      catalog_tool_count: SERENA_CATALOG.length,
      advertised_tool_count: this.tools.size,
      active_tool_count: this.activeTools.size,
      advertised_tools: [...this.tools].sort(),
      semantic_tools: semanticTools,
      mutation_tools_advertised: mutationToolsAdvertised,
      mutation_tools_active: mutationToolsActive
    };
  }

  async callSemantic(name, argumentsValue = {}) {
    if (!SEMANTIC_TOOLS.has(name)) {
      throw new SerenaAdapterError(
        "SERENA_TOOL_DENIED",
        "Serena tool is not in the semantic-only allowlist",
        { tool: name }
      );
    }
    if (!this.client) {
      await this.connect();
    }
    if (!this.activeTools.has(name)) {
      throw new SerenaAdapterError(
        "SERENA_TOOL_UNAVAILABLE",
        "Pinned Serena did not expose the requested semantic tool",
        { tool: name }
      );
    }

    const result = await this.client.callTool({
      name,
      arguments: argumentsValue
    });
    if (result?.isError) {
      throw new SerenaAdapterError(
        "SERENA_TOOL_FAILED",
        "Serena semantic tool returned an error",
        { tool: name, content: result.content ?? [] }
      );
    }
    const text = (result?.content ?? [])
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    return {
      ok: true,
      tool: name,
      result: result?.structuredContent?.result ?? text,
      content: result?.content ?? []
    };
  }

  async close() {
    const client = this.client;
    this.client = null;
    this.tools = new Set();
    this.activeTools = new Set();
    this.currentConfig = "";
    await client?.close();
  }
}
