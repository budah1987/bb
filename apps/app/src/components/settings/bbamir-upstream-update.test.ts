import type { Host } from "@bb/domain";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { findBbamirUpdateTarget } from "./bbamir-upstream-update";

const host: Host = {
  id: "host_local",
  name: "Local",
  type: "persistent",
  status: "connected",
  maxPermissionMode: "full",
  lastSeenAt: null,
  lastRejectedProtocolVersion: null,
  createdAt: 0,
  updatedAt: 0,
};

const project = {
  id: "proj_bbamir",
  kind: "standard" as const,
  name: "BBamir",
  gitRemoteUrl: "https://github.com/budah1987/bb.git",
  githubAccountLogin: null,
  createdAt: 0,
  updatedAt: 0,
  sources: [
    {
      id: "src_local",
      projectId: "proj_bbamir",
      type: "local_path" as const,
      hostId: "host_local",
      path: "/work/bb",
      isDefault: true,
      createdAt: 0,
      updatedAt: 0,
    },
  ],
  threads: [],
  defaultExecutionOptions: null,
};

function navigation(
  projects: readonly (typeof project)[] = [project],
): SidebarBootstrapResponse {
  return {
    sections: [],
    projects: [...projects],
    personalProject: {
      ...project,
      id: "proj_personal",
      kind: "personal",
      name: "Personal",
      gitRemoteUrl: null,
      sources: [],
    },
  };
}

describe("findBbamirUpdateTarget", () => {
  it("selects the connected default checkout", () => {
    expect(
      findBbamirUpdateTarget({
        hosts: [host],
        navigation: navigation(),
        primaryHostId: host.id,
      }),
    ).toEqual({
      status: "ready",
      target: {
        hostId: host.id,
        projectId: project.id,
        projectName: project.name,
        sourcePath: "/work/bb",
      },
    });
  });

  it("refuses to guess when two BBamir projects exist", () => {
    expect(
      findBbamirUpdateTarget({
        hosts: [host],
        navigation: navigation([project, { ...project, id: "proj_bbamir_2" }]),
        primaryHostId: host.id,
      }),
    ).toMatchObject({ status: "ambiguous" });
  });

  it("refuses a disconnected checkout", () => {
    expect(
      findBbamirUpdateTarget({
        hosts: [{ ...host, status: "disconnected" }],
        navigation: navigation(),
        primaryHostId: host.id,
      }),
    ).toMatchObject({ status: "missing" });
  });
});
