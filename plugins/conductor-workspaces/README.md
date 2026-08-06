# Conductor Workspaces

An independently updateable BB plugin that projects native BB repositories,
environments, and threads into a Conductor-style sidebar. It requires BB
0.36.0-conductor.1 or newer because it uses the generic sidebar thread-list,
thread context bar, close-handler, and environment rename APIs added for
third-party sidebar providers.

The plugin changes presentation only. Thread ids, environment ids, parent
relationships, drafts, unread state, archives, and deep links remain native BB
data, so switching back to BB's standard sidebar is lossless.

## Install from Git

Publish this directory as its own Git repository, then install its tracking
`main` branch:

```sh
bb plugin install 'git:https://github.com/<owner>/bb-plugin-conductor-workspaces.git@main'
```

Choose **Conductor** under **Settings → Appearance → Sidebar** on each client.
The desktop and mobile web apps load the same plugin bundle, but the sidebar
choice is client-local so mobile can be enabled and tested independently.

Tracking a branch keeps plugin releases separate from BB releases. Preview and
apply compatible updates with:

```sh
bb plugin outdated
bb plugin update conductor-workspaces --yes
```

The manifest's `engines.bb` and `engines.bbPluginSdk` ranges stop BB from
installing an incompatible update. Failed managed updates roll back to the
previous working plugin snapshot.

## Keep BB current

The maintenance boundary is intentional:

- BB core owns only generic plugin hooks, native environment rename behavior,
  and host-level shortcut interception. Those changes should be contributed to
  upstream BB and contain no Conductor-specific policy.
- This repository owns the layout, projection, activity animation, tab model,
  menus, gestures, and shortcuts. Normal BB releases do not overwrite it.
- UI primitives under `components/ui/` are vendored source. They preserve BB's
  theme and responsive drawer behavior without importing the private
  `@bb/shared-ui` workspace package.
- Public declarations under `types/` and the test harness under
  `test-support/` are pinned to the SDK version in the manifest. Production
  SDK imports are supplied by BB, so a Git install never depends on an
  unpublished monorepo package.

When BB ships a new version, update BB normally first. `bb plugin outdated`
will report whether a compatible Conductor update exists; if BB changes a
generic API, update the plugin's engine range and vendored UI components in one
small plugin release rather than carrying a long-lived BB UI fork.

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

Install dependencies, then run the standalone checks and build:

```sh
npm install
npm test
npm run typecheck
bb plugin build
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

The plugin upgrades the orphaned `conductor-workspaces` prototype in place.
Its migration zero preserves the prototype's `workspaces` table, and projection
version 2 treats those anchor threads as legacy organizers: they are hidden by
the Conductor view but never deleted. Every other active thread is grouped by
`projectId + environmentId`; threads without an environment appear in an
explicit **Local conversations** workspace.

Each projection is validated before its signature is recorded. Every active,
non-organizer conversation must appear exactly once; missing or duplicate
conversations abort recording; archived and unassigned counts remain explicit;
and rerunning with the same native state is idempotent. The record is
observability metadata only, so reconciliation never changes a BB thread or
environment.

## Conversation signals

Workspace rows, thread rows, and conversation tabs reserve a 12px signal slot.
Active work uses a subtle 5×5 pixel wave, unread or waiting work uses the same
matrix frozen into a bright center, and idle renders no icon. Rows also say
**Working**, **Needs attention**, or **Dormant**, so motion and color are never
the only cues. Reduced-motion clients get a static activity matrix.

On compact viewports, the active conversation stays in a responsive tab rail
and additional conversations move into a touch-friendly bottom drawer. Context
menus support right-click on desktop and long press on touch devices.
