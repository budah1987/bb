import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "conductor.css"),
  "utf8",
);

describe("Conductor sidebar theme mapping", () => {
  it("derives the expanded repository card from semantic sidebar tokens", () => {
    const rule = css.match(
      /\.conductor-project-sortable\[data-expanded\]\s*\{([^}]*)\}/s,
    )?.[1];

    expect(rule).toBeDefined();
    expect(rule).toContain("var(--sidebar-accent) 55%");
    expect(rule).toContain("var(--sidebar-border) 55%");
    expect(rule).toContain("var(--sidebar)");
    expect(rule).not.toContain("var(--canvas)");
  });

  it("keeps working conversation indicators animated outside the active tab", () => {
    expect(css).toContain(
      ".conductor-pixel-matrix--working .conductor-pixel:nth-child(7)",
    );
    expect(css).not.toMatch(
      /\.conductor-conversation-tab:not\(\[data-active\]\)[^{]*\{\s*animation:\s*none/s,
    );
  });

  it("reserves sturdy compact hit areas for tab utility controls", () => {
    const overflowRules = Array.from(
      css.matchAll(
        /^\.conductor-context-bar\[data-compact\] \.conductor-more-tabs-trigger\s*\{([^}]*)\}/gms,
      ),
      (match) => match[1],
    );
    const newConversationRule = css.match(
      /\.conductor-context-bar\[data-compact\] \.conductor-new-conversation-slot\s*\{([^}]*)\}/s,
    )?.[1];

    expect(overflowRules).toContainEqual(
      expect.stringContaining("width: 3.5rem"),
    );
    expect(overflowRules).toContainEqual(
      expect.stringContaining("flex-basis: 3.5rem"),
    );
    expect(newConversationRule).toContain("width: 2.75rem");
    expect(newConversationRule).toContain("flex-basis: 2.75rem");
  });
});
