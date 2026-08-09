import { describe, expect, it } from "vitest";
import {
  createNotesFixedPanelTab,
  createTerminalFixedPanelTab,
  createThreadStorageFilePreviewFixedPanelTab,
  createWorkspaceFilePreviewFixedPanelTab,
  normalizeFixedPanelTabsState,
  createEmptyFixedPanelTabsState,
  type FixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import {
  buildOrderedSecondaryPanelFileTabs,
  pruneStorageTabs,
  removeWorkspaceTabsForOtherEnvironments,
} from "./secondaryPanelTabState";
import { pruneTerminalTabsForSessions } from "./terminalPanelTabs";

// Panel tab state is server-persisted and shared across devices, so the
// standalone compact PWA hides the Notes tab by filtering what it RENDERS.
// Every prune that runs on any surface must therefore leave the tab in state:
// a prune writes a new tabs revision and would delete the desktop's tab.
describe("notes tab retention", () => {
  const notesTab = createNotesFixedPanelTab();

  function withNotes(...tabs: readonly FixedPanelTab[]): FixedPanelTab[] {
    return [notesTab, ...tabs];
  }

  it("survives the workspace-environment prune", () => {
    const tabs = withNotes(
      createWorkspaceFilePreviewFixedPanelTab({
        environmentId: "env-old",
        projectId: null,
        tab: {
          lineRange: null,
          path: "src/index.ts",
          source: { kind: "working-tree" },
          statusLabel: null,
        },
      }),
    );
    expect(removeWorkspaceTabsForOtherEnvironments(tabs, "env-new")).toEqual([
      notesTab,
    ]);
  });

  it("survives the thread-storage prune", () => {
    const tabs = withNotes(
      createThreadStorageFilePreviewFixedPanelTab({
        environmentId: null,
        isPinned: false,
        tab: { lineRange: null, path: "plan.md" },
        threadId: "thr_1",
      }),
    );
    expect(
      pruneStorageTabs({
        knownPaths: new Set<string>(),
        tabs,
        threadId: "thr_1",
      }),
    ).toEqual([notesTab]);
  });

  it("survives the terminal-session prune", () => {
    const tabs = withNotes(createTerminalFixedPanelTab({ terminalId: "t1" }));
    expect(
      pruneTerminalTabsForSessions({
        retainedTerminalId: null,
        tabs,
        terminalSessions: [],
      }),
    ).toEqual([notesTab]);
  });

  it("survives state normalization, unlike the transient new tab", () => {
    const normalized = normalizeFixedPanelTabsState({
      state: {
        ...createEmptyFixedPanelTabsState(),
        secondary: {
          tabs: [notesTab],
          activeTabId: notesTab.id,
          isOpen: true,
        },
      },
    });
    expect(normalized.secondary.tabs).toEqual([notesTab]);
    expect(normalized.secondary.activeTabId).toBe(notesTab.id);
  });

  it("is ordered into the file-tab strip", () => {
    expect(
      buildOrderedSecondaryPanelFileTabs({
        tabs: [notesTab],
        resolvedEnvironmentId: null,
      }),
    ).toEqual([notesTab]);
  });
});
