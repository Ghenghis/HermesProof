# HermesProof STREAM Discipline for KiloCode

At session start and every 3-5 minutes while idle:

1. Read `handoffs/STREAM/PROTOCOL.md`.
2. Read `handoffs/STREAM/STATE.md`.
3. Read `handoffs/STREAM/KILOCODE_INBOX.md`.
4. Acknowledge open messages addressed to ANY or to your current role.
5. Before editing, claim a task and acquire HermesProof locks for the files.
6. Post HEARTBEAT on long tasks, append evidence after material changes, and
   release locks when finished.

Never read private `.env` files or secret directories. Never use force-push,
`--no-verify`, release tags, or direct main/develop pushes.
