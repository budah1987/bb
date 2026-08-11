const PLUGIN_NEW_THREAD_DRAFT_KEY_LOCATION_STATE = "pluginNewThreadDraftKey";

export function buildPluginWorkspaceDraftLocationState(args: {
  environmentId: string | null;
  projectId: string;
}): { pluginNewThreadDraftKey: string } {
  return {
    pluginNewThreadDraftKey: `sidebar-workspace:${args.projectId}:${args.environmentId ?? "unassigned"}`,
  };
}

export function buildPluginWorkspaceDraftNavigationState(args: {
  environmentId: string | null;
  locked: boolean;
  projectId: string;
}): {
  pluginNewThreadDraftKey: string;
  reuseEnvironmentId?: string;
  lockEnvironment?: true;
} {
  return {
    ...(args.environmentId === null
      ? {}
      : { reuseEnvironmentId: args.environmentId }),
    ...buildPluginWorkspaceDraftLocationState(args),
    ...(args.environmentId !== null && args.locked
      ? { lockEnvironment: true as const }
      : {}),
  };
}

export function resolvePluginWorkspaceDraftNavigationState(args: {
  environmentId: string | null | undefined;
  fallbackProjectId?: string;
  locked: boolean;
  projectId?: string;
}): ReturnType<typeof buildPluginWorkspaceDraftNavigationState> | null {
  const projectId = args.projectId ?? args.fallbackProjectId;
  if (args.environmentId === undefined || projectId === undefined) return null;
  return buildPluginWorkspaceDraftNavigationState({
    environmentId: args.environmentId,
    locked: args.locked,
    projectId,
  });
}

// react-router location.state is freeform unknown. Keep the plugin draft key
// behind one boundary parser before it selects client-local draft storage.
export function readPluginNewThreadDraftKeyFromLocationState(
  state: unknown,
): string | null {
  if (!state || typeof state !== "object") return null;
  const candidate = (state as Record<string, unknown>)[
    PLUGIN_NEW_THREAD_DRAFT_KEY_LOCATION_STATE
  ];
  return typeof candidate === "string" && candidate.length > 0
    ? candidate
    : null;
}
