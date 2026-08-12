# Task completion

A coding task is complete only when all applicable checks have fresh output:

1. Confirm exact HermesProof task/locks were held for every edited file.
2. Run targeted `node --test <test-file>` while developing.
3. Run `npm test`.
4. Run MCP stdio and workflow smokes relevant to the change.
5. Run `npm run truth-gates` for release-facing changes; do not accept skipped workspace, client, harness, or verification gates as release proof.
6. Run secret scan, SBOM/checksum generation, and docs/registry parity gates for release changes.
7. Append Hermes evidence containing commands, exit codes, artifact hashes, and commit SHA.
8. Verify clean tracked worktree, push the review branch, and confirm both local and remote branch SHA.
9. Release locks/task only after evidence is durable.