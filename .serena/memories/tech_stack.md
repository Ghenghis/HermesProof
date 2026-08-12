# Technology stack

- JavaScript ESM (`.mjs`) on Node.js >=20; release baseline uses Node 22.
- MCP transport and schemas: `@modelcontextprotocol/sdk` plus Zod.
- Tests: built-in `node:test` and `node:assert/strict`; no transpilation step.
- Package manager: npm with committed `package-lock.json`; install with `npm ci`.
- CI: GitLab CI and GitHub Actions; proof artifacts include JSON, SBOM, checksums, and attestations.
- Serena semantic indexing must use the TypeScript language server for JavaScript/`.mjs`.