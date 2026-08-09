import type { Host } from "@bb/domain";
import { isLocalPathProjectSource } from "@bb/domain";
import type { SidebarBootstrapResponse } from "@bb/server-contract";

type SidebarProject = SidebarBootstrapResponse["projects"][number];

export interface BbamirUpdateTarget {
  hostId: string;
  projectId: string;
  projectName: string;
  sourcePath: string;
}

export type BbamirUpdateTargetState =
  | { status: "loading" }
  | { status: "ready"; target: BbamirUpdateTarget }
  | { status: "missing"; message: string }
  | { status: "ambiguous"; message: string };

interface FindBbamirUpdateTargetArgs {
  hosts: readonly Host[] | undefined;
  navigation: SidebarBootstrapResponse | undefined;
  primaryHostId?: string | null;
}

function isBbamirProject(project: SidebarProject): boolean {
  return (
    project.kind === "standard" &&
    project.name.trim().toLocaleLowerCase() === "bbamir"
  );
}

/**
 * Selects the one safe source that the settings action may update. Returning a
 * non-ready state is intentional: an update must never guess between two
 * BBamir checkouts or run against a disconnected machine.
 */
export function findBbamirUpdateTarget(
  args: FindBbamirUpdateTargetArgs,
): BbamirUpdateTargetState {
  if (args.navigation === undefined || args.hosts === undefined) {
    return { status: "loading" };
  }

  const projects = args.navigation.projects.filter(isBbamirProject);
  if (projects.length === 0) {
    return {
      status: "missing",
      message:
        "Add the BBamir repository as a project to enable source updates.",
    };
  }
  if (projects.length > 1) {
    return {
      status: "ambiguous",
      message: "Choose one BBamir project before starting an update.",
    };
  }

  const project = projects[0];
  const connectedHostIds = new Set(
    args.hosts
      .filter((host) => host.status === "connected")
      .map((host) => host.id),
  );
  const sources = project.sources.filter(
    (source) =>
      isLocalPathProjectSource(source) && connectedHostIds.has(source.hostId),
  );
  if (sources.length === 0) {
    return {
      status: "missing",
      message: "Connect the machine that owns the BBamir checkout first.",
    };
  }

  const primaryDefaultSources = sources.filter(
    (source) => source.isDefault && source.hostId === args.primaryHostId,
  );
  const defaultSources = sources.filter((source) => source.isDefault);
  const preferredSources =
    primaryDefaultSources.length > 0 ? primaryDefaultSources : defaultSources;
  const selectedSources =
    preferredSources.length > 0 ? preferredSources : sources;
  if (selectedSources.length !== 1) {
    return {
      status: "ambiguous",
      message:
        "BBamir has more than one connected checkout; choose the source to update.",
    };
  }

  const source = selectedSources[0];
  if (!isLocalPathProjectSource(source)) {
    return {
      status: "missing",
      message: "BBamir needs a local checkout before it can be updated.",
    };
  }
  return {
    status: "ready",
    target: {
      hostId: source.hostId,
      projectId: project.id,
      projectName: project.name,
      sourcePath: source.path,
    },
  };
}
