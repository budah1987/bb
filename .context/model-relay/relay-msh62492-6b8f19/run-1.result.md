## Outcome
Foundation landed. Four files touched, four added; no server/daemon, CLI, or protocol surface involved.

**Added**
- `apps/app/src/hooks/useStandaloneCompactPwa.ts` — `useStandaloneCompactPwa()` = shared-ui compact viewport AND (`(display-mode: standalone)` via `useMediaQuery` OR the legacy iOS `navigator.standalone` flag). The legacy flag is read through an `in` narrow and compared `=== true`, so no cast and no truthiness leak. Exports `STANDALONE_DISPLAY_MODE_QUERY`.
- `apps/app/src/hooks/useStandaloneCompactPwa.test.tsx` — compact+standalone true; desktop-width standalone false; compact browser tab false; legacy iOS flag true; non-boolean legacy flag false.
- `apps/app/src/lib/command-center-navigation.ts` — `CommandCenterNavigation` contract (`kind`, `returnPath`, `returnPaneId`, all required), `createCommandCenterNavigation`, `parseCommandCenterNavigation(state: unknown)` (boundary parse: exact kind literal, `/`-rooted non-empty `returnPath`, non-empty `returnPaneId`), and the pure `shouldPreserveLayoutForCommandCenter({content, isStandaloneCompactPwa, navigation})`.
- `apps/app/src/lib/command-center-navigation.test.ts` — parse accept/reject table (null, string, wrong kind, partial shapes, relative path, empty pane id, wrong types) plus the policy's one-true/three-false matrix.

**Changed**
- `SplitThreadArea.tsx` — reads the capability and `useLocation().state`, computes `preservesCommandCenterLayout` (requires a stored layout, `new-thread` content, capability, and a validated intent), and skips `reconcileLayoutForContent` only then. Every other route, including direct `/`, is byte-identical to before.
- `SplitThreadArea.test.tsx` — `renderSplitArea` now accepts `locationState`; new `describe` drives the real display-mode query via a `matchMedia` stub: preservation (both panes, contents, `focusedPaneId` intact), negative compact-browser reconcile (focused pane replaced exactly as today), and unvalidated state in the installed app also reconciling.
- `sidebar.tsx` — `SidebarInset` gates the global pointer/touch swipe registration effect and the wheel effect on the capability, and clears any in-flight session when it turns true. Button opening, Vaul swipe-to-close, and all browser-tab/desktop behavior untouched.
- `sidebar.test.tsx` — new browser-tab wheel-open positive, new standalone-compact test asserting swipe+wheel are silent while the trigger still opens the Vaul drawer; both existing swipe tests unchanged and passing.

## Evidence
`store.get(splitLayoutAtom)` after the Command Center commit keeps `[thread thr-a, thread thr-b]` and `focusedPaneId: "pane-2"`; the same render with the standalone query false yields `[thread thr-a, new-thread]` — the gate is what separates them, not the fixture.

## Verification
- `pnpm exec turbo run typecheck --filter=@bb/app` — pass (re-run `--force` after final edit).
- `pnpm exec turbo run test --filter=@bb/app` (full suite) — 321 files / 2393 tests pass.
- Focused re-run of sidebar, capability, contract, `SplitThreadArea` + parity + archive + `splitThreadNavigation` — 7 files / 74 tests pass.
- `eslint` clean on all touched files; `prettier --check` clean.

## Deviations and risks
- I ran `prettier --write` on `sidebar.tsx` and it also reflowed a pre-existing unformatted `if` in `shouldIgnoreSidebarSwipeTarget` (that file is not prettier-clean in `HEAD`). I reverted that unrelated hunk; the diff is now scoped to my change.
- The capability is consumed but nothing yet *produces* `CommandCenterNavigation`, so `createCommandCenterNavigation` currently has only test callers — intentional per "preview isn't part of this stage".
- The legacy iOS flag is read per render, not subscribed; it cannot change for the life of the document. Display-mode changes remain reactive.
- Not implemented, per scope: workspace swipe/preview/transition UI, history pop-on-return, chrome ownership migration.

## Next action
Stage B (compact pane traversal via `getAdjacentPaneId`/`listPanes`) and the gesture layer that pushes `createCommandCenterNavigation` state.

IMPLEMENTATION_COMPLETE
