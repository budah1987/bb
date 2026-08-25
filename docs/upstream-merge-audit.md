# Upstream merge audit

`scripts/upstream-merge-audit.mjs` previews an upstream merge with Git's
`merge-tree` plumbing. It writes Git objects but never changes the index or
working tree.

```bash
node scripts/upstream-merge-audit.mjs \
  --upstream-ref desktop-v0.39.0 \
  --json audit.json \
  --markdown audit.md
```

Pass `--remote upstream` to fetch the requested ref first. Exit `0` means the
merge is clean or all conflicts are mechanical, exit `2` means human review is
required, and exit `1` means the audit itself failed.

Generated conflicts may be resolved only after all source conflicts are gone.
Then rebuild them in this order:

```bash
pnpm exec turbo run build --filter=@get-bb/plugin-sdk
node packages/templates/scripts/generate-templates.mjs
```

Version-only conflicts use the lockstep fork command:

```bash
node scripts/bump-version.mjs --fork-version 0.39.0
```

## Drizzle conflicts

Every `packages/db/drizzle/**` conflict is fail-closed. The report identifies
journal collisions by `idx`, `tag`, and `when`, but intentionally provides no
fixer. Reconcile schema and SQL changes manually, regenerate migrations through
Drizzle, and validate both an empty-database replay and an upgrade from the
latest released BBamir database. Never hand-edit a Drizzle snapshot.

## Protocol waivers

Wire-adjacent upstream changes require a strictly higher
`HOST_DAEMON_PROTOCOL_VERSION` or a waiver in
`scripts/upstream-audit/protocol-waivers.json`. A waiver applies only to one
exact 40-character upstream SHA, must cover every flagged path, must name
existing compatibility tests, and must record its rationale, approver, date,
and current protocol version. Invalid or incomplete waivers remain
review-required.
