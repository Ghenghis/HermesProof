# Local Proof

Generated in ChatGPT sandbox before packaging.

## Gate

```text
npm test
```

## Result

```text
PASS — scripts/coordination-smoke-test.mjs
```

## What the test proves

- Claude can claim and lock contract docs.
- Codex can claim and lock code files.
- A Claude reviewer cannot lock a Codex-owned file.
- A blocked agent receives the current owner and must request a handoff.
- Codex can approve the handoff.
- Ownership transfers to the reviewer.
- Codex cannot silently edit the transferred file without requesting ownership back.
- Evidence can be appended.

## Note

The test uses only the internal lock manager and Node's built-in test runner, so it can pass before MCP SDK dependencies are installed. Run `npm install` before connecting the MCP server to Claude, Codex, or Windsurf.
