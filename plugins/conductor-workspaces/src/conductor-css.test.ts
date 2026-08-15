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
});
