# Suggested commands

- Install exactly: `npm ci`
- Run server: `npm start`
- Full committed test suite: `npm test`
- Coordination smoke: `npm run smoke`
- Hardening smoke: `npm run smoke:hardening`
- Registry validation: `npm run smoke:registry`
- Supervisor smoke: `npm run smoke:supervisor`
- Truth proof locally: `npm run truth-gates`
- CI proof subset: `npm run truth-gates -- --ci`
- User environment doctor: `npm run doctor`
- Dry-run client setup before writes: `npm run wizard -- --dry-run`
- Serena memory reference check: `serena memories check`
- Windows file listing: `Get-ChildItem`; fast code search: `rg <pattern>`.
- Inspect branch/remotes: `git status --short --branch`, `git remote -v`.