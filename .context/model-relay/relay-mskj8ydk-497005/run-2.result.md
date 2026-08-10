I have what I need — the action-tile and browser-chrome patterns give the exact components and tokens to specify against. Here's the UX addendum.

## Outcome

Transport resolution accepted: header-borne bearer lease with fetch + streaming JPEG parser closes the P2 cleanly, and typed control APIs avoid a second socket surface. UX addendum follows; it is implementation-ready against existing components.

**New Tab action.** One `NewTabActionTile` (`NewTabFileSearch.tsx:326`) under the existing Actions section, after "Start terminal": `iconName="Smartphone"`, label **"Open simulator"**. When a session is running for the thread's environment, append a trailing affix in the shortcut slot position: `text-muted-foreground` text **"Running"** preceded by a 6px `bg-emerald-500`-equivalent semantic status dot (use the existing running-status token BB uses for thread activity, not a raw palette literal). Row always visible when the thread has an environment; capability resolution happens in-tab.

**Tab chrome.** Tab pill: Smartphone icon + device name once known, else "Simulator". Content header uses `SECONDARY_PANEL_TOP_CHROME_BACKGROUND_CLASS` and the browser `NavButton` pattern (icon + `aria-label` + optional shortcut, `CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS`): left — device name + state text ("Booted", "Reconnecting…") in `COARSE_POINTER_TEXT_SM_CLASS` `text-muted-foreground`; right — **Home** (icon `Circle`), **Rotate** (`RotateCw`), **Screenshot** optional, **Stop** (`Square`, destructive-subtle). All controls hidden outside states 5–6; never render dead buttons.

**States and copy.** (1) Centered spinner, "Checking simulator support…". (2) "iOS Simulator requires a Mac with Xcode" + one secondary line naming the environment's host OS; no controls. (3) "No simulator runtimes installed" + "Install a runtime from Xcode ▸ Settings ▸ Components"; **Check again** secondary button. (4) Device `Select` (grouped by runtime, newest iPhone default, last-used remembered per environment) + primary button **"Start simulator"**. (5) Stage text "Booting device…" → "Connecting…", indeterminate progress, always-present **Stop** (best-effort, per prior review). (6) Live surface; transient "Reconnecting…" pill overlays top edge on stream drop without unmounting the frame. (7) Error line (one sentence, no stack), selection preserved, primary **Retry**. (8) "Host disconnected — waiting to reconnect…", auto-recovers to prior state.

**Pointer/keyboard.** The phone surface is one focusable region (`role="application"`, `aria-label="iOS simulator screen — <device>"`, visible focus ring on the device bezel). Pointer: down/move/up map to tap/drag with client→device coordinate scaling; wheel/trackpad scroll maps to scroll gesture; no synthetic hover. Keyboard: when the surface has focus, printable keys and Return/Backspace/arrows forward to the device; paste forwards clipboard text; **Escape releases focus** to normal tab navigation (announce via the region's description: "Press Escape to leave the simulator"). Chrome buttons stay reachable by Tab, never captured.

**Responsive.** Surface letterboxes at device aspect ratio, `max-height` bound to panel, centered on `bg-sidebar`; portrait/landscape swap animates only if cheap, otherwise cuts. Below ~320px width, header collapses buttons into an overflow menu (existing panel overflow pattern).

**Accessibility.** All icon buttons have `aria-label` + tooltip; state transitions announce via a polite `aria-live` region ("Simulator booted", "Connection lost"); non-interactive fallback text in states 2/3/7/8 is real text, not imagery; contrast per semantic tokens only.

**Visual acceptance checks.** No `text-[Npx]` or achromatic `oklch` literals (theme.test.ts guards); states 2–8 screenshot-tested in Storybook alongside existing `ThreadSecondaryPanel` stories; "Running" affix visible in the New Tab story; keyboard-only walkthrough can start, focus, type into, and stop the simulator.

## Evidence

`NewTabFileSearch.tsx` (tile/shortcut-slot pattern), `BrowserTabContent.tsx` (chrome classes, NavButton, coarse-pointer sizing), `panelChromeClasses`, AGENTS.md UI token rules.

## Verification

Read-only review; component/class names confirmed present in tree.

## Deviations and risks

Escape-to-release is mandatory — without it the surface is a keyboard trap (WCAG 2.1.2). "Running" dot must use a semantic status token; verify one exists before inventing.

## Next action

Sol folds this addendum into the plan and proceeds to implementation.

APPROVED_WITH_CONCERNS
