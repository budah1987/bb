import { describe, expect, it } from "vitest";
import { assembleDockerProvenance } from "../../../src/services/environments/docker-provenance.js";

describe("assembleDockerProvenance", () => {
  it("flags same-repository mounts from another checkout", () => {
    const response = assembleDockerProvenance({
      result: {
        outcome: "available",
        workspaceGit: {
          branch: "feature",
          commonDir: "/repo-main/.git",
          root: "/repo-feature",
        },
        containers: [
          {
            composeWorkingDirGit: null,
            id: "wrong",
            image: "example/api:latest",
            mounts: [
              {
                destination: "/app/apps/api/dist",
                readOnly: false,
                source: "/repo-main/apps/api/dist",
                sourceGit: {
                  branch: "main",
                  commonDir: "/repo-main/.git",
                  root: "/repo-main",
                },
              },
            ],
            labels: {
              composeProject: "bb",
              composeService: "api",
              composeWorkingDir: "/repo-main",
              getbbRole: null,
            },
            name: "api",
            publishedPorts: [43100],
            state: "running",
          },
          {
            composeWorkingDirGit: null,
            id: "unrelated",
            image: "other/service:latest",
            mounts: [
              {
                destination: "/app/dist",
                readOnly: false,
                source: "/other/dist",
                sourceGit: {
                  branch: "main",
                  commonDir: "/other/.git",
                  root: "/other",
                },
              },
            ],
            labels: {
              composeProject: null,
              composeService: null,
              composeWorkingDir: null,
              getbbRole: null,
            },
            name: "other",
            publishedPorts: [9000],
            state: "running",
          },
        ],
      },
    });

    expect(response).toEqual({
      outcome: "available",
      environmentPath: "/repo-feature",
      services: [
        {
          checkoutStatus: "wrong_checkout",
          id: "wrong",
          image: "example/api:latest",
          kind: "server",
          mounts: [
            {
              checkoutRoot: "/repo-main",
              destination: "/app/apps/api/dist",
              readOnly: false,
              source: "/repo-main/apps/api/dist",
            },
          ],
          name: "api",
          ownerBranch: "main",
          ownerCheckoutRoot: "/repo-main",
          publishedPorts: [43100],
          state: "running",
        },
      ],
    });
  });

  it("keeps a declared shared worker that has no bind mount", () => {
    const response = assembleDockerProvenance({
      result: {
        containers: [
          {
            composeWorkingDirGit: {
              branch: "main",
              commonDir: "/repo-main/.git",
              root: "/repo-main",
            },
            id: "worker",
            image: "example/worker:latest",
            labels: {
              composeProject: "bb",
              composeService: "worker",
              composeWorkingDir: "/repo-main",
              getbbRole: "shared-worker",
            },
            mounts: [],
            name: "worker",
            publishedPorts: [],
            state: "running",
          },
        ],
        outcome: "available",
        workspaceGit: {
          branch: "feature",
          commonDir: "/repo-main/.git",
          root: "/repo-feature",
        },
      },
    });

    expect(response).toMatchObject({
      services: [
        {
          checkoutStatus: "declared_shared",
          id: "worker",
          kind: "shared_worker",
          ownerBranch: "main",
          ownerCheckoutRoot: "/repo-main",
        },
      ],
    });
  });

  it("reports mixed same-repository checkout owners as ambiguous", () => {
    const response = assembleDockerProvenance({
      result: {
        containers: [
          {
            composeWorkingDirGit: null,
            id: "mixed",
            image: "example/api:latest",
            labels: {
              composeProject: "bb",
              composeService: "api",
              composeWorkingDir: null,
              getbbRole: null,
            },
            mounts: [
              {
                destination: "/app/a",
                readOnly: false,
                source: "/repo-main/a",
                sourceGit: {
                  branch: "main",
                  commonDir: "/repo-main/.git",
                  root: "/repo-main",
                },
              },
              {
                destination: "/app/b",
                readOnly: false,
                source: "/repo-feature/b",
                sourceGit: {
                  branch: "feature",
                  commonDir: "/repo-main/.git",
                  root: "/repo-feature",
                },
              },
            ],
            name: "api",
            publishedPorts: [43100],
            state: "running",
          },
        ],
        outcome: "available",
        workspaceGit: {
          branch: "feature",
          commonDir: "/repo-main/.git",
          root: "/repo-feature",
        },
      },
    });

    expect(response).toMatchObject({
      services: [
        {
          checkoutStatus: "ambiguous",
          ownerBranch: null,
          ownerCheckoutRoot: null,
        },
      ],
    });
  });
});
