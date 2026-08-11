/**
 * GitHub palette. The dark anchors match GitHub Dark (#0d1117 / #e6edf3),
 * while the derived BB neutral ramp produces GitHub's raised sidebar and
 * control surfaces. The blue accent stays reserved for focus and primary
 * actions, as it is in GitHub's own interface.
 */
export const githubThemeCss = `
:root, .light {
  --canvas: #ffffff;
  --ink: #1f2328;
  --primary: #0969da;
  --primary-foreground: #ffffff;
  --muted-foreground: #57606a;
  --readback-foreground: #57606a;
  --subtle-foreground: #6e7781;
  --timeline-accent: #0969da;
  --file-accent: var(--timeline-accent);
  --destructive: #cf222e;
  --destructive-text: #a40e26;
  --warning: #9a6700;
  --warning-text: #7d4e00;
  --attention: #bf8700;
  --success: #1a7f37;
  --diff-added: #1a7f37;
  --diff-removed: #cf222e;
  --pr-merged: #8250df;
  --ansi-0: #24292f;  --ansi-bg-fg-0: #ffffff;
  --ansi-1: #cf222e;  --ansi-bg-fg-1: #ffffff;
  --ansi-2: #1a7f37;  --ansi-bg-fg-2: #ffffff;
  --ansi-3: #9a6700;  --ansi-bg-fg-3: #ffffff;
  --ansi-4: #0969da;  --ansi-bg-fg-4: #ffffff;
  --ansi-5: #8250df;  --ansi-bg-fg-5: #ffffff;
  --ansi-6: #1b7c83;  --ansi-bg-fg-6: #ffffff;
  --ansi-7: #57606a;  --ansi-bg-fg-7: #ffffff;
  --ansi-8: #6e7781;  --ansi-bg-fg-8: #ffffff;
  --ansi-9: #a40e26;  --ansi-bg-fg-9: #ffffff;
  --ansi-10: #116329; --ansi-bg-fg-10: #ffffff;
  --ansi-11: #7d4e00; --ansi-bg-fg-11: #ffffff;
  --ansi-12: #0550ae; --ansi-bg-fg-12: #ffffff;
  --ansi-13: #6639ba; --ansi-bg-fg-13: #ffffff;
  --ansi-14: #0969da; --ansi-bg-fg-14: #ffffff;
  --ansi-15: #1f2328; --ansi-bg-fg-15: #ffffff;
}
.dark {
  --canvas: #0d1117;
  --ink: #e6edf3;
  --primary: #1f6feb;
  --primary-foreground: #ffffff;
  --muted-foreground: #b1bac4;
  --readback-foreground: #9da7b3;
  --subtle-foreground: #8b949e;
  --timeline-accent: #58a6ff;
  --file-accent: var(--timeline-accent);
  --state-hover: color-mix(in oklab, var(--ink) 5%, transparent);
  --state-active: color-mix(in oklab, var(--ink) 9%, transparent);
  --sidebar-accent: #21262d;
  --sidebar-border: #30363d;
  --destructive: #f85149;
  --destructive-text: #ff7b72;
  --warning: #d29922;
  --warning-text: #e3b341;
  --attention: #d29922;
  --success: #3fb950;
  --diff-added: #3fb950;
  --diff-removed: #f85149;
  --pr-merged: #a371f7;
  --ansi-0: #484f58;  --ansi-bg-fg-0: #ffffff;
  --ansi-1: #ff7b72;  --ansi-bg-fg-1: #0d1117;
  --ansi-2: #3fb950;  --ansi-bg-fg-2: #0d1117;
  --ansi-3: #d29922;  --ansi-bg-fg-3: #0d1117;
  --ansi-4: #58a6ff;  --ansi-bg-fg-4: #0d1117;
  --ansi-5: #d2a8ff;  --ansi-bg-fg-5: #0d1117;
  --ansi-6: #39c5cf;  --ansi-bg-fg-6: #0d1117;
  --ansi-7: #b1bac4;  --ansi-bg-fg-7: #0d1117;
  --ansi-8: #8b949e;  --ansi-bg-fg-8: #0d1117;
  --ansi-9: #ffa198;  --ansi-bg-fg-9: #0d1117;
  --ansi-10: #56d364; --ansi-bg-fg-10: #0d1117;
  --ansi-11: #e3b341; --ansi-bg-fg-11: #0d1117;
  --ansi-12: #79c0ff; --ansi-bg-fg-12: #0d1117;
  --ansi-13: #d2a8ff; --ansi-bg-fg-13: #0d1117;
  --ansi-14: #56d4dd; --ansi-bg-fg-14: #0d1117;
  --ansi-15: #f0f6fc; --ansi-bg-fg-15: #0d1117;
}
`;
