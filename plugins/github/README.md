# bb-plugin-github

GitHub issues and pull requests for BB projects, with repo-scoped conversations.

Install it from the BB Official catalog:

```sh
bb plugin install github
```

## What it does

- **Sidebar panel** (GitHub logo, full width): Issues and Pull requests tabs
  across every tracked repo, with a repo filter (persisted in localStorage)
  and a New issue form.
- **Issue detail**: markdown body, comments, comment box, status,
  assignee, and label editing, plus a repo-scoped conversation action.
  Deep-linkable via the URL hash: `#/issues/<owner>/<repo>/<number>`.
- **Open / Start conversation**: opens an existing linked conversation or
  creates a task in the item's BB project. Pull requests start in a managed
  worktree at the PR head; issues start from the project's default branch.
  The issue or pull request then links back to that task.
- **Mentions**: `@` or `#` in any composer completes GitHub issues and PRs; the
  selected item's title/body/state is attached as agent context at send time.
- **`bb github` CLI**: `repos`, `issues [repo]`, `prs [repo]`, `sync` — also
  discoverable by agents through the plugin-commands skill.

## Auth

Uses the GitHub CLI. If `gh auth status` passes, the plugin works; otherwise
it reports needs-configuration. No tokens are stored by the plugin.

## Which repos are tracked

Only repositories attached to BB projects are shown. The project's GitHub
remote, selected GitHub account, and default local source determine both what
can be viewed and exactly where a new conversation workspace is created.
Repositories assigned to a different GitHub CLI identity stay visible. Existing
BB conversations still open, while live GitHub actions and new workspaces wait
until that identity is active (for example, with
`gh auth switch --user <login>`).

A background service refreshes the issue/PR cache every 5 minutes; the
panel's Refresh button (or `bb github sync`) forces it.

## Development

Run the checks from the repository root:

```sh
pnpm exec turbo run typecheck test --filter=bb-plugin-github
```
