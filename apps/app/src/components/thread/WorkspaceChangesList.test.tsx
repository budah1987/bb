import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceChangesList } from "./WorkspaceChangesList";

const { useVirtualizer } = vi.hoisted(() => ({ useVirtualizer: vi.fn() }));

vi.mock("@tanstack/react-virtual", () => ({ useVirtualizer }));

describe("WorkspaceChangesList", () => {
  beforeEach(() => {
    useVirtualizer.mockReturnValue({
      getTotalSize: () => 240_000,
      getVirtualItems: () => [
        { index: 0, start: 0 },
        { index: 1, start: 24 },
        { index: 2, start: 48 },
      ],
      measureElement: vi.fn(),
    });
  });

  it("mounts only virtual rows for a large scrollable file list", () => {
    const files = Array.from({ length: 10_000 }, (_, index) => ({
      path: `changed-${index}.ts`,
      status: "M" as const,
      insertions: null,
      deletions: null,
    }));

    const markup = renderToStaticMarkup(
      <WorkspaceChangesList files={files} onFileClick={() => {}} />,
    );

    expect(useVirtualizer).toHaveBeenCalledWith(
      expect.objectContaining({ count: 10_000, overscan: 6 }),
    );
    expect(markup).toContain("changed-0.ts");
    expect(markup).toContain("changed-2.ts");
    expect(markup).not.toContain("changed-3.ts");
    expect(markup).not.toContain("changed-9999.ts");
  });
});
