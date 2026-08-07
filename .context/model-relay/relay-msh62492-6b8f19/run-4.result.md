## Outcome

**1 · Real thread titles.** `CompactCommandCenterIntro` now subscribes to `useSidebarNavigation()` — the same cached query the root compose page reads for its Recent rows — and builds a `threadId → getThreadDisplayTitle()` map from `personalProject.threads` plus every project's. New pure `paneRowLabel(content, navPanels, threadTitleById)` in `compactWorkspaceLabels.ts`: thread → cached title, `"Thread"` when still loading or unlisted; plugin registered titles and `"New thread"` unchanged. `describePaneContent` (the mid-gesture `ThreadShell`/`PanelShell` vocabulary) is untouched and still generic and inert. New pure `selectWorkspaceRows(panes, activePaneId, limit)` centres the capped window on the active pane and clamps at both ends, never reordering, so the active row is always present; the trailing number is now the pane's true workspace position rather than its index in the window.

**2 · Release velocity.** New `WORKSPACE_SWIPE_VELOCITY_STALE_MS = 100` and pure `readReleaseVelocity(velocityX, idleMsBeforeRelease)`; the host applies it to `session.velocityX` at `pointerup` only, so a fast 15% drag held still before lifting cancels while an immediate 15% release at ≥450 px/s still commits the adjacent pane. `pointercancel`/`lostpointercapture` remain pure cancel paths with no velocity read.

**3 · External cancellation.** `abandonGesture` now calls `releasePointer(host, session.pointerId)` (feature-detected) before nulling the session, so a captured finger is handed back rather than left attached to a surface that stopped tracking it.

**4 · Split-layout gate.** The workspace host is now gated on `threadSplitsEnabled` as well as the capability. With the experiment off nothing writes `splitLayoutAtom`, so a long Command Center commit would have animated and then no-op'd; the disabled experiment instead keeps its existing promise of the byte-identical pre-split page. Chrome ownership is deliberately *not* gated — `AppLayout` stands down on the capability alone, so the page still carries the plugin header there.

## Evidence
New/extended tests: `compactWorkspaceLabels.test.ts` (distinct cached titles, `"Thread"` fallback, plugin/compose labels, shell vocabulary unchanged, active-pane-in-window for every active pane, centring/clamping, unknown active pane); `workspaceSwipeGesture.test.ts` (`readReleaseVelocity` boundary at exactly 100 ms, and paused-vs-immediate 15% release); `SplitThreadArea.test.tsx` — three-pane Command Center list asserting `["Refactor the swipe host", "Ship release notes", "Thread"]`, paused-fling cancel followed by an immediate commit at the same distance, `releasePointerCapture(1)` asserted on external mid-gesture navigation, splits-disabled has no host and no navigation, and splits-disabled plugin routes still render `[data-compact-plugin-panel-surface] header`.

## Verification
`turbo typecheck --filter=@bb/app` pass · `turbo test --filter=@bb/app --force` → **324 files / 2437 tests pass** (`/tmp/s4-full.txt`) · `turbo lint --filter=@bb/app` 0 errors (142 pre-existing warnings, none in touched files) · `prettier --check` clean on every touched file. `.impeccable.md` and `.context/` untouched; no server/daemon or protocol files changed.

## Deviations and risks
- I reuse the *data source* (`useSidebarNavigation`) but flatten the two thread lists inline (4 lines) instead of importing `buildMobileRecentThreads` from `RootComposeView`: that module is stubbed by several test files, so importing a named export from it breaks them at import time, and it drags a 3.5k-line view into this component. Same query, same shape, no new endpoint — but it is a small duplication of the flatten.
- Row cap stays 4; with 5+ panes the list is a window, and panes outside it are reachable only by swipe or sidebar.
- Titles are as fresh as the sidebar navigation query; a thread renamed since the last fetch shows the older title until it revalidates.
- Device-only risks unchanged from the previous pass (host clipping, iOS edge-swipe interplay, settle feel).

## Next action
On-device QA of the four compact surfaces, then decide whether the workspace list should page beyond four panes.

IMPLEMENTATION_COMPLETE
