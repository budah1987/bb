// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShipWorkflowActions } from "./ShipWorkflowActions";

afterEach(cleanup);

describe("ShipWorkflowActions", () => {
  it("runs the current shipping step", () => {
    const onCommit = vi.fn();
    render(
      <ShipWorkflowActions
        actions={[{ kind: "commit", label: "Commit", onSelect: onCommit }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Commit" }));

    expect(onCommit).toHaveBeenCalledOnce();
  });

  it("keeps alternate merge methods behind one primary action", () => {
    const onMerge = vi.fn();
    render(
      <ShipWorkflowActions
        actions={[
          {
            kind: "merge_pull_request",
            label: "Merge",
            onSelect: onMerge,
          },
          {
            kind: "merge_pull_request",
            label: "Squash and merge",
            onSelect: vi.fn(),
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Merge" }));

    expect(onMerge).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("button", { name: "Choose merge method" }),
    ).not.toBeNull();
  });
});
