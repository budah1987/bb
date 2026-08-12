import { describe, expect, it, vi } from "vitest";
import { createPaneSecondaryPanelRegistry } from "./PaneContext";

function createPanelModel(contentKey: string) {
  return {
    composerHost: null,
    contentKey,
    isMainCollapsed: false,
    isOpen: false,
    panel: null,
    onToggle: vi.fn(),
  };
}

describe("createPaneSecondaryPanelRegistry", () => {
  it("ignores cleanup from content that no longer owns the pane", () => {
    const registry = createPaneSecondaryPanelRegistry();
    const oldModel = createPanelModel("old-thread");
    const activeModel = createPanelModel("active-thread");

    registry.publish("pane-1", oldModel);
    registry.publish("pane-1", activeModel);
    registry.clear("pane-1", oldModel.contentKey);

    expect(registry.getSnapshot("pane-1")).toBe(activeModel);

    registry.clear("pane-1", activeModel.contentKey);
    expect(registry.getSnapshot("pane-1")).toBeNull();
  });
});
