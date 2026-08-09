import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  SERENA_CATALOG,
  SERENA_COMMIT,
  SERENA_DEFAULT_DIRECT_TOOLS,
  SERENA_DEFAULT_GUARDED_TOOLS,
  SERENA_JETBRAINS_DIRECT_TOOLS,
  SERENA_JETBRAINS_GUARDED_TOOLS,
  SERENA_OPTIONAL_DIRECT_TOOLS,
  SERENA_OPTIONAL_GUARDED_TOOLS,
  SERENA_QUERY_GUARDED_TOOLS,
  SERENA_SELECTED_LSP_TOOLS,
  SERENA_SOURCE,
  SERENA_TOOL_ROUTES,
  SERENA_VERSION
} from "../src/hp-mha-serena/serena-catalog.mjs";

export function buildSerenaRuntimePolicy() {
  return {
    schema_version: 1,
    generated: true,
    runtime: {
      name: "serena-agent",
      version: SERENA_VERSION,
      commit: SERENA_COMMIT,
      source: SERENA_SOURCE,
      install: {
        runner: "uvx",
        pin: "immutable-git-commit",
        windows_environment: {
          PYTHONUTF8: "1",
          SERENA_USAGE_REPORTING: "false"
        }
      },
      transport: "stdio",
      language_backend: "LSP",
      language_servers: ["typescript"],
      project_config: ".serena/project.yml",
      context_config: ".serena/hermesproof-context.yml",
      read_only: true,
      dashboard_enabled: false
    },
    inventory: {
      full_catalog_count: SERENA_CATALOG.length,
      desktop_default_count:
        SERENA_DEFAULT_DIRECT_TOOLS.length + SERENA_DEFAULT_GUARDED_TOOLS.length,
      selected_lsp_direct_count: SERENA_SELECTED_LSP_TOOLS.length,
      selected_lsp_direct_tools: [...SERENA_SELECTED_LSP_TOOLS],
      default_guarded_count: SERENA_DEFAULT_GUARDED_TOOLS.length,
      default_guarded_tools: [...SERENA_DEFAULT_GUARDED_TOOLS],
      optional_lsp_direct_tools: [...SERENA_OPTIONAL_DIRECT_TOOLS],
      optional_lsp_guarded_tools: [...SERENA_OPTIONAL_GUARDED_TOOLS],
      query_guarded_tools: [...SERENA_QUERY_GUARDED_TOOLS],
      jetbrains_direct_tools: [...SERENA_JETBRAINS_DIRECT_TOOLS],
      jetbrains_guarded_tools: [...SERENA_JETBRAINS_GUARDED_TOOLS],
      all_tools: [...SERENA_CATALOG].sort(),
      routes: Object.fromEntries(
        Object.entries(SERENA_TOOL_ROUTES).sort(([left], [right]) =>
          left.localeCompare(right)
        )
      )
    },
    enforcement: {
      raw_serena_mutations_active: 0,
      project_switching_active: false,
      shell_active: false,
      memory_mutations_active: false,
      mcp_tools_list_must_equal_selected_surface: true,
      workspace_binding_required: true,
      hermes_task_claim_required_for_mutation: true,
      exact_file_lock_required_for_mutation: true,
      source_hash_receipt_required_for_mutation: true,
      fail_closed: true
    },
    capability_packs: {
      lsp_semantic: {
        default: true,
        direct: true,
        tools: [...SERENA_SELECTED_LSP_TOOLS]
      },
      lsp_mutation: {
        default: false,
        route: "hp-mha-serena-broker",
        tools: [
          ...SERENA_DEFAULT_GUARDED_TOOLS,
          ...SERENA_OPTIONAL_GUARDED_TOOLS
        ]
      },
      cross_project_query: {
        default: false,
        route: "signed-workspace-query-broker",
        tools: [...SERENA_QUERY_GUARDED_TOOLS]
      },
      jetbrains: {
        default: false,
        prerequisite: "Serena JetBrains plugin and matching open project",
        direct_read_only_tools: [...SERENA_JETBRAINS_DIRECT_TOOLS],
        guarded_tools: [...SERENA_JETBRAINS_GUARDED_TOOLS]
      }
    },
    local_truth_gates: [
      "serena --version",
      "serena tools list --all",
      "serena project health-check",
      "serena memories check",
      "serena project index",
      "node --test scripts/serena-integration-e2e.test.mjs"
    ],
    audited_official_sources: [
      "https://oraios.github.io/serena/01-about/020_programming-languages.html",
      "https://oraios.github.io/serena/01-about/035_tools.html",
      "https://oraios.github.io/serena/02-usage/010_installation.html",
      "https://oraios.github.io/serena/02-usage/020_running.html",
      "https://oraios.github.io/serena/02-usage/030_clients.html",
      "https://oraios.github.io/serena/02-usage/040_workflow.html",
      "https://oraios.github.io/serena/02-usage/045_memories.html",
      "https://oraios.github.io/serena/02-usage/050_configuration.html",
      "https://oraios.github.io/serena/02-usage/060_dashboard.html",
      "https://oraios.github.io/serena/02-usage/065_logs.html",
      "https://oraios.github.io/serena/02-usage/070_security.html",
      "https://oraios.github.io/serena/02-usage/999_additional-usage.html",
      "https://github.com/oraios/serena/blob/main/CHANGELOG.md",
      "https://github.com/oraios/serena/blob/main/pyproject.toml"
    ],
    observed_dev0_constraints: [
      {
        id: "SERENA_CONTEXT_REGISTRY_ORDER",
        observation:
          "Project exclusions alter active tools after the MCP registry is created.",
        mitigation:
          "Use the versioned HermesProof context to exclude risky tools during server construction."
      },
      {
        id: "SERENA_OPTIONAL_CONTEXT_REQUIRED",
        observation:
          "Project-only optional inclusions may be active in get_current_config but absent from tools/list.",
        mitigation:
          "Include selected optional tools in the versioned startup context and assert live callability."
      },
      {
        id: "SERENA_WINDOWS_UTF8",
        observation:
          "Windows CP-1252 terminals can fail while printing successful CLI glyphs.",
        mitigation:
          "Set PYTHONUTF8=1 for all HermesProof-launched Serena processes."
      },
      {
        id: "SERENA_INFO_JETBRAINS_ONLY",
        observation:
          "serena_info currently accepts only the jet_brains_debug_repl topic.",
        mitigation:
          "Keep serena_info out of the default LSP surface and route it with the JetBrains pack."
      }
    ]
  };
}

export function writeSerenaRuntimePolicy({
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
} = {}) {
  const outputPath = path.join(root, "policies", "serena-runtime.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(
    outputPath,
    JSON.stringify(buildSerenaRuntimePolicy(), null, 2) + "\n",
    "utf8"
  );
  return outputPath;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === invokedPath) {
  process.stdout.write(writeSerenaRuntimePolicy() + "\n");
}
