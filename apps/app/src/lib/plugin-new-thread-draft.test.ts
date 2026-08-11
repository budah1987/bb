import { describe, expect, it } from "vitest";
import {
  buildPluginWorkspaceDraftLocationState,
  readPluginNewThreadDraftKeyFromLocationState,
  resolvePluginWorkspaceDraftNavigationState,
} from "./plugin-new-thread-draft";

describe("plugin workspace new-thread drafts", () => {
  it("keeps an explicit environment without a loaded sidebar entry", () => {
    expect(
      resolvePluginWorkspaceDraftNavigationState({
        environmentId: "env_1",
        locked: true,
        projectId: "proj_1",
      }),
    ).toEqual({
      lockEnvironment: true,
      pluginNewThreadDraftKey: "sidebar-workspace:proj_1:env_1",
      reuseEnvironmentId: "env_1",
    });
  });

  it("keeps the draft stable within one workspace and isolated across workspaces", () => {
    const first = buildPluginWorkspaceDraftLocationState({
      projectId: "proj_1",
      environmentId: "env_1",
    });
    const same = buildPluginWorkspaceDraftLocationState({
      projectId: "proj_1",
      environmentId: "env_1",
    });
    const other = buildPluginWorkspaceDraftLocationState({
      projectId: "proj_1",
      environmentId: "env_2",
    });

    expect(readPluginNewThreadDraftKeyFromLocationState(first)).toBe(
      "sidebar-workspace:proj_1:env_1",
    );
    expect(same).toEqual(first);
    expect(other).not.toEqual(first);
  });

  it("keeps an unassigned workspace draft in its project", () => {
    expect(
      buildPluginWorkspaceDraftLocationState({
        projectId: "proj_1",
        environmentId: null,
      }),
    ).toEqual({
      pluginNewThreadDraftKey: "sidebar-workspace:proj_1:unassigned",
    });
  });

  it("rejects stale or malformed navigation state", () => {
    expect(readPluginNewThreadDraftKeyFromLocationState(null)).toBeNull();
    expect(
      readPluginNewThreadDraftKeyFromLocationState({
        pluginNewThreadDraftKey: "",
      }),
    ).toBeNull();
    expect(
      readPluginNewThreadDraftKeyFromLocationState({
        pluginNewThreadDraftKey: 42,
      }),
    ).toBeNull();
  });
});
