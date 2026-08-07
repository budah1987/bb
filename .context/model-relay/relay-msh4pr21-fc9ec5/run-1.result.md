Review complete. I verified the plan against the split-layout reconciliation code, the compact rendering path in `SplitThreadArea`, the sidebar gesture implementation, `AppLayout` header ownership, and `RootComposeView`.

## Outcome
Verdict: **REVISE.** The approach is sound (top-level Command Center destination, gesture coordinator extraction, non-destructive pane focus all fit the code), but four material decisions are missing or contradictory.

## Evidence
- `splitThreadNavigation.ts:68-88` — `reconcileLayoutForContent` replaces the focused pane's content for any non-matching route. `SplitThreadArea.tsx:254` runs it on every route change.
- `SplitThreadArea.tsx:571-580` — compact renders only the route thread as `StandalonePaneContent`; `SplitPaneCommandHandlers` (and thus `pane.focus.previous/next`) is not mounted when split is inactive, and each handler gates on `isSplitActive`.
- `AppLayout.tsx:404` — AppLayout, not the page surface, owns the header when split workspace is inactive (i.e., all compact today).
- `sidebar.tsx:23-33` — existing gesture constants are 220ms `cubic-bezier(0.32,0.72,0,1)`, not the specified 250ms `(0.22,1,0.36,1)`; wheel-to-open is compact-wide, not standalone-scoped.

## Deviations and risks
- **P1 — Command Center route mechanism is undecided and the current wording is hazardous.** "Route may remain `/`" plus "preserved top-level destination" collide with the reconciliation effect: navigating to `/` makes `currentContent` a `new-thread` pane and `reconcileLayoutForContent` overwrites the focused workspace pane — exactly the destruction the plan forbids. The plan must pick one: a compact-only presentation state that never changes the route, or a route change with an explicit reconciliation guard, and must define history/back semantics for the chosen option.
- **P1 — Scope contradiction on gesture removal.** §3 says "remove global swipe and wheel-to-open sidebar behavior," but acceptance says "desktop/Safari-tab behavior unchanged." Unconditional removal changes compact Safari tabs. State explicitly whether removal is standalone-compact-scoped or product-wide, and align acceptance.
- **P1 — Header ownership migration is unstated.** "Each surface owns its header" requires moving compact header ownership out of AppLayout, or running two ownership models (AppLayout outside standalone-compact, surface-owned inside). This is the largest structural change in the plan and needs its own decision and stage — it currently hides inside stage C.
- **P2 — Preview pane cost vs 60fps acceptance.** Rendering the adjacent pane during drag means mounting a full thread view (timeline, queries, terminals) mid-gesture on older iPhones. Specify the preview strategy: mount-on-gesture-start with inert content, snapshot, or lightweight placeholder — and note that `pane.focus.*` reuse means extracting `getAdjacentPaneId` traversal, not the existing handlers, which don't exist on compact.
- **P2 — Motion tokens.** Extracting the sidebar coordinator will carry 220ms/`(0.32,0.72,0,1)` constants; the spec demands 250ms/`(0.22,1,0.36,1)`. Define shared tokens and state whether the drawer keeps its current curve or unifies.
- **P2 — Command Center focus discipline.** `RootComposeView` autofocuses its composer on several triggers; as a swiped-in preview it must not steal focus or spawn its secondary panel until commit. Add this to the transition-host contract.
- Product trade-off (not a defect): overloading rightward swipe with a distance threshold (short = previous tab, long = Command Center) is the riskiest interaction; the resistance + static cue mitigation is reasonable, but acceptance should add a fling-velocity case proving a fast short fling cannot cross the 65-70% destination change.

## Verification
Read-only review; no files modified. MAX_PANES=8 matches the "1-8 panes" acceptance; keeping wire protocols untouched matches AGENTS.md.

## Next action
Sol resolves the three P1 decisions (Command Center route mechanism, removal scope, header ownership) and annotates the P2s in the final plan; no re-exploration needed.

REQUEST_CHANGES
