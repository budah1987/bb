## Outcome
Stage 2 landed: parser tightened, pure gesture policy, gesture host with inert preview, and the Command Center round trip.

**Parser** — `command-center-navigation.ts` now rejects `returnPath` starting with `//` (protocol-relative), with a case in the reject table.

**Added**
- `views/thread-detail/workspaceSwipeGesture.ts` (+ jsdom test): intent 12px + horizontal dominance, vertical abandon, `decideWorkspaceSwipe` (pane at 33%, or ≥12% with ≥450px/s **in the same direction**; Command Center only on rightward distance ≥68%, never velocity), `resolveWorkspaceSwipePaneId` delegating to the existing `getAdjacentPaneId` (reading order, wrapping), `describeWorkspacePosition`, and `shouldIgnoreWorkspaceSwipeTarget` (controls, contenteditable, slider, Radix dialog/menu/listbox/popper, Vaul, sidebar panel/trigger, `data-no-workspace-swipe`, horizontal scrollers, expanded selection).
- `views/thread-detail/CompactWorkspaceSwipeHost.tsx`: touch-only pointer coordinator — `touch-pan-y`, capture taken only after horizontal intent, imperative `translate3d` while dragging, 250ms `cubic-bezier(0.22,1,0.36,1)` settle, and deterministic teardown on pointerup/pointercancel/lostpointercapture/resize/orientationchange/unmount (capture released, source restored, exactly one surface). Wraps the **complete** standalone page (header, body, composer, accessories) by cancelling the layout's page padding and re-applying it per layer. Polite `aria-live` position announcement after commit; reduced motion drops the positional settle for a quiet opacity cue and keeps the behavior.
- `views/thread-detail/CompactWorkspacePreviewSurface.tsx`: inert `aria-hidden`, non-focusable shells built from `PaneContent` alone — Command Center (blank composer hint + "Recent"), thread, panel. No `ThreadDetailView`/`RootComposeView`/plugin runtime mounts mid-gesture.
- `lib/swipe-gesture-targets.ts`: the scroller/selection predicates, now shared with `sidebar.tsx` (which changed only to consume them — no behavior change).

**Commits** — short swipe: `setFocus` + `navigate(paneContentRoute, {replace})`, layout untouched. Long right: one pushed `/` entry with `createCommandCenterNavigation(returnPath, focusedPaneId)`. Left swipe out of a gesture-opened Command Center: `navigate(-1)`.

## Evidence
New integration tests assert: previous/next pane focus + route (wrapping); a 23%/25 000px/s fling commits a pane and leaves `command-center-state` as `none`; a 78% right drag yields `/threads/thr-b|pane-2` validated state with both panes and focus intact; the return pops (a subsequent `navigate(1)` reaches `/` again); preview is `aria-hidden`, has zero focusable nodes and no real view; pointercancel clears the transform; a drag started on the composer textarea does nothing; a compact browser tab renders no host at all.

## Verification
- `turbo run typecheck --filter=@bb/app` — pass.
- `turbo run test --filter=@bb/app --force` — 322 files / 2414 tests pass (+21).
- `turbo run lint --filter=@bb/app` — 0 errors (142 pre-existing warnings, none in new files). Fixed 4 React-Compiler memoization errors my first draft introduced by moving the pane derivation into `StandaloneWorkspaceSurface`.
- `prettier --check` clean on all touched files.

## Deviations and risks
- **Plugin panels sit the gesture out**, as source and destination: their compact header lives in `AppLayout`, so moving only the body would split chrome. Test-pinned. This is the compact chrome-ownership migration, still deferred.
- Deferred as instructed: Command Center "Needs You" UI, sheet sizing.
- From a gesture-opened Command Center the only move is the return (its focused pane still holds the source thread).
- No mid-gesture `selectionchange` cancel (pointerdown-time check only).
- Reload on the Command Center keeps the history state, so `navigate(-1)` could exit the app; the validated `returnPath` is carried but not yet used as a fallback.
- Pointer capture is feature-detected (absent in jsdom).
- Untested on device: host `overflow-hidden` could clip a non-portalled overlay that used to escape the page box.

## Next action
Move compact page chrome into the surface so plugin panels can participate, then the return-path fallback and Command Center content.

IMPLEMENTATION_COMPLETE
