# BBamir Workspaces

The compatibility plugin for BBamir's Conductor presentation. The BB app shell
now loads the sidebar, context bars, repository details, and action routes from
this package into the host bundle. The app does not require the plugin runtime
or its frontend assets to render Conductor.

The plugin changes presentation only. Thread ids, environment ids, parent
relationships, drafts, unread state, archives, and deep links remain native BB
data, so switching back to BB's standard sidebar is lossless.

## Use in BBamir

The authoritative source lives at `plugins/conductor-workspaces` on the
`bbamir/main` branch of `budah1987/bb`. BBamir compiles the presentation into
the app bundle. The app keeps the `conductor-workspaces` identity so existing
sidebar preferences and deep links remain valid.

Choose **BBamir** under **Settings → Appearance → Sidebar** on each client.
The desktop and mobile web apps load the same host bundle. The sidebar choice
is client-local, so each client can select BBamir, BB, or T3 independently.

The plugin runtime remains available for legacy reconciliation, conversation
transcript mentions, and rollback testing. Core Conductor behavior continues
when the plugin is disabled.

## Keep BB current

The maintenance boundary is intentional:

- The app shell owns Conductor selection, loading, navigation, responsive
  mounting, repository details, and core SDK actions.
- This package supplies the shared presentation source and the compatibility
  plugin. Both compile from one source tree, so they cannot drift.
- UI primitives under `components/ui/` are vendored source. They preserve BB's
  theme and responsive drawer behavior without importing the private
  `@bb/shared-ui` workspace package.
- Public declarations under `types/` and the test harness under
  `test-support/` are pinned to the SDK version in the manifest. Production
  SDK imports are supplied by BB, so a Git install never depends on an
  unpublished monorepo package.

When BB ships a new version, fast-forward the fork's `main` branch and merge it
into `bbamir/main`. Update the host and compatibility builds together when an
SDK contract changes.

To refresh a vendored component against the BB release declared in
`components.json`:

```sh
npx shadcn add @bb/dialog @bb/dropdown-menu
```

Review the generated diff before committing because vendored components are
owned by the plugin and never update implicitly.

When the plugin SDK version changes, refresh `types/` and `test-support/` from
the matching BB release in the same commit as the `engines.bbPluginSdk` change.
The standalone contract test prevents a private workspace dependency from
being reintroduced accidentally.

## Development

Install the monorepo dependencies, then run the plugin checks and build through
Turbo:

```sh
pnpm install
pnpm exec turbo run test typecheck build --filter=bb-plugin-conductor-workspaces
```

For local iteration, install the directory once and let BB rebuild and reload
it:

```sh
bb plugin install .
bb plugin dev .
```

Git installs run `npm install` and build the plugin from source using the
installed BB toolchain. An npm release should ship `dist/`; a Git release does
not need to commit generated bundles.

## Reconciliation

The compatibility plugin upgrades the orphaned `conductor-workspaces`
prototype in place.
Its migration zero preserves the prototype's `workspaces` table, and projection
version 2 treats those anchor threads as legacy organizers: they are hidden by
the BBamir view but never deleted. Every other active thread is grouped by
`projectId + environmentId`; threads without an environment appear in an
explicit **Local conversations** workspace.

Each projection is validated before its signature is recorded. Every active,
non-organizer conversation must appear exactly once; missing or duplicate
conversations abort recording; archived and unassigned counts remain explicit;
and rerunning with the same native state is idempotent. The record is
observability metadata only, so reconciliation never changes a BB thread or
environment. The host treats unavailable plugin storage as an empty legacy
projection, so this database is never a runtime dependency.

## Conversation signals

Workspace rows, thread rows, and conversation tabs reserve a 12px signal slot.
Active work uses a subtle 5×5 pixel wave, unread or waiting work uses the same
matrix frozen into a bright center, and idle renders no icon. Rows also say
**Working** or **Needs attention** when a conversation is active; idle rows stay
quiet, so motion and color are never the only cues. Reduced-motion clients get
a static activity matrix.

On compact viewports, the active conversation stays in a responsive tab rail
and additional conversations move into a touch-friendly bottom drawer. Context
menus support right-click on desktop and long press on touch devices.
