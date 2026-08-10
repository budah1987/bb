I've grounded the review in the tab-state schema, New Tab actions, host-daemon contract, and shared-port coordinator. Here is the plan review.

## Outcome

**APPROVED_WITH_CONCERNS.** The architecture, boundary placement, and MVP cut are sound. Entry point: **New Tab Actions row only** for MVP — it matches the existing Browser/Terminal precedent (`NewTabActions` in `NewTabFileSearch.tsx:765`), and a permanent header icon would pay a chrome cost for an occasional feature. Stage the header icon behind observed re-entry friction, not speculation. Environment-scoped session + thread-scoped tab matches the existing mental model (terminal/browser tabs already bind `environmentId`). Revised plan = Sol's plan plus the corrections below folded in.

Revisions to fold in:

1. **(P1) Lifecycle reconciliation must be explicit.** Specify: simulator shutdown on environment stop/teardown; daemon restart re-derives the environment→UDID registry from `simctl list` (or persists it) and kills orphaned helpers. Without this, closed-tab-but-running sessions leak RAM-heavy simulators on the user's Mac indefinitely. Also define restored-tab semantics: `simulator` tabs persist in per-thread localStorage for 14 days (`fixed-panel-tabs-state.ts:21`), so on restore the tab must re-run attach/status and degrade to the ready state, never render a stale "live" shell.
2. **(P1) Tab identity.** Make the simulator tab a singleton per environment via `buildFixedPanelTabId({ environmentId, kind: "simulator", ... })` so reopen-focuses-existing falls out of existing normalization/dedup (`fixed-panel-tabs-state.ts:744`), and add it to the strict zod union + `areFixedPanelTabsEquivalent`.
3. **(P2) Lease transport.** MJPEG via `<img src>` puts the token in a URL, conflicting with "never logged." Decide now: fetch-stream with header auth, or URL lease with scrubbed logs and ≤ minutes TTL + rotation on reconnect.
4. **(P2) Running-without-tab visibility.** Closing the tab keeping the device alive is right (agents keep driving it), but surface it: the "Open simulator" action row shows a "Running" affix when a session exists.
5. **(P2) State 5 cancel.** Replace "cancel only if reliable" with an always-present best-effort Stop (idempotent shutdown) — a conditional control is worse UX than a stop that occasionally waits.
6. **(P2) Repo-rule compliance.** Any `BbPluginApi`/plugin-sdk surface needs the `experimental_` prefix + `docs/api_to_audit.md` entry; `bb simulator` must update the surfaces listed in `docs/cli-guide-and-skill.md`; no accepted-but-ignored fields in the new RPC commands; fill device default at the server boundary. `HOST_DAEMON_PROTOCOL_VERSION` (currently 80, `commands.ts:39`) bump confirmed necessary.

Scope: keep tap/drag/scroll, typing, Home, Rotate, Stop, screenshot+AX (CLI/SDK mandatory per AGENTS.md agent-parity rule; screenshot UI button optional). Show the action row unconditionally with in-tab states 1–3 rather than hiding it — discoverability beats the browser-entry hiding precedent here since capability is async. Persist last-chosen device per environment; default to newest iPhone runtime. MJPEG-first with parking: agreed.

## Evidence

`fixed-panel-tabs-state.ts` (union, persistence, expiry, dedup), `NewTabPage.tsx`/`NewTabFileSearch.tsx` (action-row pattern), `commands.ts` (protocol v80, strict schemas), `host-shared-ports.ts` (server-owned shared-port policy exists for tunnel reuse), AGENTS.md (parity, plugin-API, boundary rules), `.worktree-memory.md` (serve-sim review already done — not re-verified here).

## Verification

Read-only review; no code executed. serve-sim input-injection capabilities taken on Sol's prior review.

## Deviations and risks

Plan-file write and ExitPlanMode unavailable to this worker (read-only toolset); deliverable is this report. Residual risk: remote-Mac tunnel latency for interactive input is unvalidated — keep the stated primary-Mac fallback.

## Next action

Sol folds items 1–6 into the plan and proceeds to implementation; no second review round needed unless the lease-transport decision changes the contract.

APPROVED_WITH_CONCERNS
