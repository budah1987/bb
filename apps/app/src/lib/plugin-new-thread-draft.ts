const PLUGIN_NEW_THREAD_DRAFT_KEY_LOCATION_STATE = "pluginNewThreadDraftKey";

export function buildPluginWorkspaceDraftLocationState(args: {
  environmentId: string | null;
  projectId: string;
}): { pluginNewThreadDraftKey: string } {
  return {
    pluginNewThreadDraftKey: `sidebar-workspace:${args.projectId}:${args.environmentId ?? "unassigned"}`,
  };
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
