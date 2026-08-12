export const SERENA_VERSION = "1.7.0";
export const SERENA_COMMIT = "949a27ef1e5fda1a6e7b561e777bcece345c6ffd";
export const SERENA_SOURCE =
  "git+https://github.com/oraios/serena@" + SERENA_COMMIT;

export const SERENA_DEFAULT_DIRECT_TOOLS = Object.freeze([
  "find_declaration",
  "find_file",
  "find_implementations",
  "find_referencing_symbols",
  "find_symbol",
  "get_current_config",
  "get_diagnostics_for_file",
  "get_symbols_overview",
  "initial_instructions",
  "list_dir",
  "list_memories",
  "read_file",
  "read_memory",
  "search_for_pattern"
]);

export const SERENA_DEFAULT_GUARDED_TOOLS = Object.freeze([
  "activate_project",
  "create_text_file",
  "delete_memory",
  "edit_memory",
  "execute_shell_command",
  "insert_after_symbol",
  "insert_before_symbol",
  "onboarding",
  "rename_memory",
  "rename_symbol",
  "replace_content",
  "replace_in_files",
  "replace_symbol_body",
  "safe_delete_symbol",
  "write_memory"
]);

export const SERENA_OPTIONAL_DIRECT_TOOLS = Object.freeze([
  "get_diagnostics_for_symbol"
]);

export const SERENA_OPTIONAL_GUARDED_TOOLS = Object.freeze([
  "delete_lines",
  "insert_at_line",
  "open_dashboard",
  "remove_project",
  "replace_lines",
  "restart_language_server"
]);

export const SERENA_QUERY_GUARDED_TOOLS = Object.freeze([
  "list_queryable_projects",
  "query_project"
]);

export const SERENA_JETBRAINS_DIRECT_TOOLS = Object.freeze([
  "serena_info",
  "jet_brains_find_declaration",
  "jet_brains_find_implementations",
  "jet_brains_find_referencing_symbols",
  "jet_brains_find_symbol",
  "jet_brains_get_symbols_overview",
  "jet_brains_list_inspections",
  "jet_brains_run_inspections",
  "jet_brains_type_hierarchy"
]);

export const SERENA_JETBRAINS_GUARDED_TOOLS = Object.freeze([
  "jet_brains_debug",
  "jet_brains_inline_symbol",
  "jet_brains_move",
  "jet_brains_rename",
  "jet_brains_safe_delete"
]);

export const SERENA_SELECTED_LSP_TOOLS = Object.freeze([
  ...SERENA_DEFAULT_DIRECT_TOOLS,
  ...SERENA_OPTIONAL_DIRECT_TOOLS
]);

export const SERENA_CATALOG = Object.freeze([
  ...SERENA_DEFAULT_DIRECT_TOOLS,
  ...SERENA_DEFAULT_GUARDED_TOOLS,
  ...SERENA_OPTIONAL_DIRECT_TOOLS,
  ...SERENA_OPTIONAL_GUARDED_TOOLS,
  ...SERENA_QUERY_GUARDED_TOOLS,
  ...SERENA_JETBRAINS_DIRECT_TOOLS,
  ...SERENA_JETBRAINS_GUARDED_TOOLS
]);

export const SERENA_TOOL_ROUTES = Object.freeze(Object.fromEntries([
  ...SERENA_DEFAULT_DIRECT_TOOLS.map((name) => [
    name,
    { backend: "lsp", availability: "default", route: "direct-read-only" }
  ]),
  ...SERENA_DEFAULT_GUARDED_TOOLS.map((name) => [
    name,
    { backend: "lsp", availability: "default", route: "hermes-guarded" }
  ]),
  ...SERENA_OPTIONAL_DIRECT_TOOLS.map((name) => [
    name,
    { backend: "lsp", availability: "optional", route: "direct-read-only" }
  ]),
  ...SERENA_OPTIONAL_GUARDED_TOOLS.map((name) => [
    name,
    { backend: "lsp", availability: "optional", route: "hermes-guarded" }
  ]),
  ...SERENA_QUERY_GUARDED_TOOLS.map((name) => [
    name,
    { backend: "project-server", availability: "mode:query-projects", route: "workspace-query-guarded" }
  ]),
  ...SERENA_JETBRAINS_DIRECT_TOOLS.map((name) => [
    name,
    { backend: "jetbrains", availability: "optional", route: "direct-read-only" }
  ]),
  ...SERENA_JETBRAINS_GUARDED_TOOLS.map((name) => [
    name,
    { backend: "jetbrains", availability: "optional", route: "hermes-guarded" }
  ])
]));
