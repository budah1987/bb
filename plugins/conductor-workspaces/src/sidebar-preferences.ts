const PROJECT_ORDER_KEY = "bb.conductor.project-order.v1";
const WORKSPACE_ORDER_KEY = "bb.conductor.workspace-order.v1";
const COLLAPSED_SECTIONS_KEY = "bb.conductor.collapsed-sections.v1";
const CLOSED_TABS_KEY = "bb.conductor.closed-tabs.v1";

function readStringArray(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(value)) return [];
    return [
      ...new Set(
        value.filter((item): item is string => typeof item === "string"),
      ),
    ];
  } catch {
    return [];
  }
}

function writeStringArray(key: string, values: readonly string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify([...new Set(values)]));
  } catch {
    // Storage can be unavailable in privacy-restricted webviews. The in-memory
    // interaction still works for the current session.
  }
}

function readStringArrayRecord(key: string): Record<string, string[]> {
  if (typeof window === "undefined") return {};
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(value).flatMap(([recordKey, recordValue]) => {
        if (!Array.isArray(recordValue)) return [];
        const strings = [
          ...new Set(
            recordValue.filter(
              (item): item is string => typeof item === "string",
            ),
          ),
        ];
        return strings.length > 0 ? [[recordKey, strings]] : [];
      }),
    );
  } catch {
    return {};
  }
}

function writeStringArrayRecord(
  key: string,
  value: Readonly<Record<string, readonly string[]>>,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in privacy-restricted webviews.
  }
}

export function loadProjectOrder(): string[] {
  return readStringArray(PROJECT_ORDER_KEY);
}

export function saveProjectOrder(projectIds: readonly string[]): void {
  writeStringArray(PROJECT_ORDER_KEY, projectIds);
}

export function loadWorkspaceOrders(): Record<string, string[]> {
  return readStringArrayRecord(WORKSPACE_ORDER_KEY);
}

export function saveWorkspaceOrders(
  workspaceOrders: Readonly<Record<string, readonly string[]>>,
): void {
  writeStringArrayRecord(WORKSPACE_ORDER_KEY, workspaceOrders);
}

export function loadCollapsedSections(): Set<string> {
  return new Set(readStringArray(COLLAPSED_SECTIONS_KEY));
}

export function saveCollapsedSections(sectionIds: ReadonlySet<string>): void {
  writeStringArray(COLLAPSED_SECTIONS_KEY, [...sectionIds]);
}

export function loadClosedTabIds(workspaceKey: string): string[] {
  return readStringArrayRecord(CLOSED_TABS_KEY)[workspaceKey] ?? [];
}

export function saveClosedTabIds(
  workspaceKey: string,
  threadIds: readonly string[],
): void {
  const record = readStringArrayRecord(CLOSED_TABS_KEY);
  const uniqueIds = [...new Set(threadIds)];
  if (uniqueIds.length > 0) record[workspaceKey] = uniqueIds;
  else delete record[workspaceKey];
  writeStringArrayRecord(CLOSED_TABS_KEY, record);
}

export function orderProjectIds(
  availableIds: readonly string[],
  preferredIds: readonly string[],
): string[] {
  const available = new Set(availableIds);
  const ordered = preferredIds.filter((id) => available.has(id));
  const included = new Set(ordered);
  return [...ordered, ...availableIds.filter((id) => !included.has(id))];
}

export function moveProjectId(
  projectIds: readonly string[],
  activeId: string,
  overId: string,
): string[] {
  const from = projectIds.indexOf(activeId);
  const to = projectIds.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return [...projectIds];
  const next = [...projectIds];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...projectIds];
  next.splice(to, 0, moved);
  return next;
}

export function orderWorkspaceKeys(
  availableKeys: readonly string[],
  preferredKeys: readonly string[],
): string[] {
  return orderProjectIds(availableKeys, preferredKeys);
}

export function moveWorkspaceKey(
  workspaceKeys: readonly string[],
  activeKey: string,
  overKey: string,
): string[] {
  return moveProjectId(workspaceKeys, activeKey, overKey);
}
