const PROJECT_CUSTOMIZATIONS_KEY = "bb.conductor.project-customizations.v1";

export type ProjectIconValue =
  | { kind: "glyph"; name: string }
  | { kind: "emoji"; value: string };

export interface ProjectCustomization {
  name?: string;
  icon?: ProjectIconValue;
}

export type ProjectCustomizations = Record<string, ProjectCustomization>;

function sanitizeIcon(value: unknown): ProjectIconValue | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const icon = value as Record<string, unknown>;
  if (icon.kind === "glyph" && typeof icon.name === "string" && icon.name) {
    return { kind: "glyph", name: icon.name };
  }
  if (icon.kind === "emoji" && typeof icon.value === "string" && icon.value) {
    return { kind: "emoji", value: icon.value };
  }
  return undefined;
}

export function sanitizeProjectCustomizations(
  value: unknown,
): ProjectCustomizations {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([projectId, entry]) => {
      if (typeof entry !== "object" || entry === null) return [];
      const record = entry as Record<string, unknown>;
      const customization: ProjectCustomization = {};
      if (typeof record.name === "string" && record.name.trim()) {
        customization.name = record.name.trim();
      }
      const icon = sanitizeIcon(record.icon);
      if (icon) customization.icon = icon;
      return Object.keys(customization).length > 0
        ? [[projectId, customization]]
        : [];
    }),
  );
}

export function loadProjectCustomizations(): ProjectCustomizations {
  if (typeof window === "undefined") return {};
  try {
    return sanitizeProjectCustomizations(
      JSON.parse(
        window.localStorage.getItem(PROJECT_CUSTOMIZATIONS_KEY) ?? "{}",
      ),
    );
  } catch {
    return {};
  }
}

export function saveProjectCustomizations(
  customizations: ProjectCustomizations,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PROJECT_CUSTOMIZATIONS_KEY,
      JSON.stringify(customizations),
    );
  } catch {
    // Storage can be unavailable in privacy-restricted webviews. The in-memory
    // interaction still works for the current session.
  }
}

export function patchProjectCustomization(
  customizations: ProjectCustomizations,
  projectId: string,
  patch: Partial<ProjectCustomization>,
): ProjectCustomizations {
  const merged: ProjectCustomization = {
    ...customizations[projectId],
    ...patch,
  };
  if (merged.name !== undefined && !merged.name.trim()) delete merged.name;
  if (patch.name === undefined && "name" in patch) delete merged.name;
  if (patch.icon === undefined && "icon" in patch) delete merged.icon;
  const next = { ...customizations };
  if (Object.keys(merged).length > 0) next[projectId] = merged;
  else delete next[projectId];
  return next;
}
