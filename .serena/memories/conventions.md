# Conventions

- Use two-space indentation, semicolons, double-quoted strings, named exports, and `.mjs` extensions.
- Prefer Node built-ins and small focused modules; preserve ESM imports with explicit file extensions.
- Tests live beside core modules as `*.test.mjs` or in `scripts/` as smoke/gate tests.
- Validate paths and stable IDs before filesystem access; normalize against the governed workspace and reject traversal.
- Filesystem writes use atomic rename patterns where durable state is involved.
- Read-only tools must not mutate state. Destructive/recovery operations require explicit semantics and evidence.
- Never treat warnings, skips, mocks, stubs, templates, timeouts, or failed verification as release success.
- Tool registry descriptions/annotations and generated docs must match the live registry.