## Outcome

**Edge cases (1).** `CompactWorkspaceSwipeHost` now ends a gesture only for its own `pointerId` (`pointerup`/`pointercancel`/`lostpointercapture`); `resize`/`orientationchange` still cancel unconditionally. New `contentKey` prop: an external content change (sidebar pick, deep link, agent open, pruned pane) abandons the session, clears the layers, and the preview is keyed so it disappears on the same render; a delayed settle also re-checks the key before committing. `isBlockingOverlayOpen` (centralized in `lib/swipe-gesture-targets.ts`, shared vocabulary with the sidebar swipe) blocks the gesture from starting under any open dialog/alertdialog/Vaul drawer/Radix popper/sidebar panel — including on an uncovered backdrop — and never dismisses one. `canPopToInAppHistoryEntry` (in `command-center-navigation.ts`) reads the router's `history.state.idx` defensively: index 0 means no in-app entry, so the return uses the validated `returnPath` with `replace`; every normal gesture-opened return still uses `navigate(-1)`.

**Chrome ownership (2).** New `CompactPluginPanelSurface` renders exactly the header AppLayout drew for plugin routes (`AppPageHeader` + `PluginPanelHeaderCenter/Actions`) inside the travelling layer; `AppLayout.showHeader` stands down for the same condition (`isStandaloneCompactPwa && pluginPanelMatch`). Plugin panes now take part in reading-order traversal and previews, named from the registered nav slot (a store read — no plugin runtime, no component mount).

**Command Center (3).** `CompactCommandCenterIntro` renders only for a validated swipe arrival: "Command Center", the `Workspace N of M` position, and a "Continue workspace" list of open panes (capped at 4) above the untouched `RootComposeView`. Rows are real buttons, `min-h-11`, `active:scale-[0.98]`, transform/colour transitions only; the row for the pane you came from performs the history return instead of a no-op refocus. A direct `/` stays the plain New thread page.

**Polish (4).** Sidebar trigger becomes 44×44 only in the installed compact app. No `transition-all` in any touched surface. `-webkit-font-smoothing: antialiased` added once, inside the existing `@media (display-mode: standalone)` block (the app set none globally). aria-live, reduced motion, focus rings, and the single interactive tree are unchanged. Sheet sizing untouched.

## Evidence
New/changed tests: multi-touch (a second finger's up/cancel neither commits nor cancels), open-dialog gate, mid-gesture external navigation (preview drops, release commits nothing), `idx: 0` fallback (no forward entry afterwards → replaced, not popped), overlay predicate across all three sidebar variants, `canPopToInAppHistoryEntry` table, plugin header inside `[data-workspace-swipe-surface="source"]`, plugin preview shows "Docs" but not "Docs panel", Command Center intro contents/44px rows/row navigation/active-row return, direct `/` has no intro, and `AppLayout` gives the compact plugin header to the page only in the installed app (the compact browser-tab test still asserts the shared header).

## Verification
`turbo typecheck --filter=@bb/app` pass · `turbo test --filter=@bb/app --force` → 323 files / 2426 tests pass (`/tmp/s3-final.txt`) · `turbo lint --filter=@bb/app` 0 errors (142 pre-existing warnings, none in new files) · prettier clean on every touched file. No protocol, server, or daemon files touched.

## Deviations and risks
- 44px was applied to the sidebar trigger only. Page header icon controls stay 36px coarse: that box is a shared token guarded by `headerIconButtonSizing.test.ts`, and widening it would resize every header app-wide.
- "Continue workspace" rows are labelled by kind / registered panel title, not thread titles — a title source (sidebar navigation query vs. per-row `useThread`) is a product decision, and I added no new data path. Row cap of 4 is my judgment call to keep the composer on screen.
- Device-only: host `overflow-hidden` could clip a non-portalled overlay; iOS system edge-swipe vs. the 68% threshold; the plugin header's new position inside the travelling layer; font-smoothing weight shift; 250ms settle feel.

## Next action
On-device QA of the four surfaces, then decide the workspace-row title source.

IMPLEMENTATION_COMPLETE
