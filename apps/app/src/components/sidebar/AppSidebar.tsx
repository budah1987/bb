import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  DEFAULT_SPACE_ID,
  SPACE_JUMP_APP_COMMAND_IDS,
  THREAD_JUMP_APP_COMMAND_IDS,
} from "@bb/domain";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useStore } from "jotai";
import { Icon } from "@bb/shared-ui/icon";
import { Button } from "@bb/shared-ui/button";
import { COARSE_POINTER_CHILD_ICON_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import { OverflowFade } from "@/components/ui/overflow-fade.js";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useCloseMobileSidebar,
  useSidebar,
} from "@/components/ui/sidebar.js";
import {
  PROJECT_LIST_ACTION_BUTTON_CLASS,
  ProjectList,
  ProjectListActionButtons,
} from "./ProjectList";
import { PluginThreadList } from "./PluginThreadList";
import { useThreadListProvider } from "./threadListProvider";
import { PluginNavSidebarItems } from "@/components/plugin/PluginNavSidebarItems";
import { PluginSidebarFooterActions } from "@/components/plugin/PluginSidebarFooterActions";
import { SidebarUpdatesBadge } from "./SidebarUpdatesBadge";
import { SidebarHistoryNavigationControls } from "./SidebarHistoryNavigationControls";
import { useQuickCreateProjectController } from "@/hooks/useQuickCreateProject";
import {
  CHROME_ROW_CLASS,
  getBbDesktopInfo,
  MACOS_CHROME_CONTROL_NO_DRAG_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import { getRootComposeRoutePath, getThreadRoutePath } from "@/lib/route-paths";
import { useThreadSplitsEnabled } from "@/hooks/useThreadSplitsEnabled";
import { usePaneContentSplitDrag } from "./usePaneContentSplitDrag";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";
import type { SidebarThreadSearchNavigationItem } from "./sidebarThreadSearch";
import { useSidebarThreadSearch } from "./useSidebarThreadSearch";
import {
  EMPTY_SIDEBAR_THREAD_SHORTCUT_KEYS,
  getSidebarThreadNavigationTargets,
  getSidebarThreadShortcutTargets,
  SidebarThreadShortcutKeysContext,
  type SidebarThreadShortcutPresentation,
  type SidebarThreadShortcutTarget,
} from "./sidebarThreadShortcuts";
import {
  useAppCommandHandler,
  useAppCommandShortcut,
  useAppCommandShortcuts,
  useIsAppCommandModifierHeld,
  useIndexedAppCommandHandlers,
} from "@/components/commands/AppCommandProvider";
import { useRouteState } from "@/hooks/useRouteState";
import {
  createCommandCenterNavigation,
  type CommandCenterNavigation,
} from "@/lib/command-center-navigation";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import type { SplitLayout } from "@/lib/split-layout";
import { SidebarUsageLimits } from "@/components/usage/CompactUsageLimits";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { useMoveProjectToSpace } from "@/hooks/mutations/space-mutations";
import { SpaceActionsProvider } from "./SpaceActionsContext";
import {
  getSpaceSidebarStyle,
  SpaceDock,
  SpaceEditor,
  type SpaceEditorState,
} from "./SpaceSidebar";
import {
  deserializeSplitLayout,
  serializeSplitLayout,
} from "@/lib/split-layout/persistence";
import { appToast } from "@/components/ui/app-toast.js";
import {
  SpacePanelTransition,
  type SpacePanelDirection,
} from "./SpacePanelTransition";

const NEW_THREAD_PANE_CONTENT = { kind: "new-thread" } as const;
const ACTIVE_SPACE_STORAGE_KEY = "bb.spaces.active";
const SPACE_VIEW_STORAGE_PREFIX = "bb.spaces.view.";

interface StoredSpaceView {
  layout: string | null;
  route: string;
}

function readStoredSpaceView(spaceId: string): StoredSpaceView | null {
  try {
    const raw = sessionStorage.getItem(
      `${SPACE_VIEW_STORAGE_PREFIX}${spaceId}`,
    );
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const value = parsed as Record<string, unknown>;
    if (typeof value.route !== "string" || !value.route.startsWith("/"))
      return null;
    if (value.layout !== null && typeof value.layout !== "string") return null;
    return { route: value.route, layout: value.layout };
  } catch {
    return null;
  }
}

const BUG_REPORT_NEW_ISSUE_URL = "https://github.com/get-bb/bb/issues/new";
const SIDEBAR_FOOTER_ACTION_CLASS = cn(
  COARSE_POINTER_CHILD_ICON_BUTTON_CLASS,
  "text-muted-foreground hover:text-sidebar-foreground [&>svg]:opacity-80",
);

interface AppSidebarProps {
  onResizeMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  isResizing: boolean;
  showTopReserve: boolean;
  settingsRoutePath: string;
  toolsRoutePath?: string;
}

export function isThreadSearchKeyboardEventTarget(
  target: EventTarget | null,
  input: HTMLInputElement | null,
): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target === input) {
    return true;
  }
  return target.closest('[role="option"]') !== null;
}

export function createSidebarCommandCenterNavigation({
  layout,
  returnPath,
}: {
  layout: SplitLayout | null;
  returnPath: string;
}): CommandCenterNavigation | undefined {
  if (layout === null) return undefined;
  return createCommandCenterNavigation({
    returnPath,
    returnPaneId: layout.focusedPaneId,
  });
}

export function MobileCommandCenterSidebarAction({
  isActive,
  onSelect,
}: {
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      data-testid="app-sidebar-command-center"
      className="hidden shrink-0 px-2 pb-2 max-md:block pointer-coarse:block"
    >
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={cn(
          PROJECT_LIST_ACTION_BUTTON_CLASS,
          "w-full",
          isActive && "bg-sidebar-accent text-sidebar-accent-foreground",
        )}
        aria-current={isActive ? "page" : undefined}
        onClick={onSelect}
      >
        <Icon name="GridView" aria-hidden="true" />
        <span className="min-w-0 truncate text-left">Command Center</span>
      </Button>
    </div>
  );
}

export function AppSidebar({
  onResizeMouseDown,
  isResizing,
  showTopReserve,
  settingsRoutePath,
  toolsRoutePath,
}: AppSidebarProps) {
  const quickCreateProject = useQuickCreateProjectController();
  // A plugin may replace the sidebar's scrolling thread list. It never
  // replaces the chrome around it: the New-thread button, the search field,
  // the plugin nav rows, and the footer stay host-rendered in every sidebar.
  const threadListProvider = useThreadListProvider();
  const { threadId: activeThreadId, isRootView } = useRouteState();
  const location = useLocation();
  const navigate = useNavigate();
  const store = useStore();
  const threadSplitsEnabled = useThreadSplitsEnabled();
  const newThreadSplit = usePaneContentSplitDrag({
    content: NEW_THREAD_PANE_CONTENT,
    enabled: threadSplitsEnabled,
    label: "New thread",
  });
  const closeOnMobile = useCloseMobileSidebar();
  const { isCompactViewport, setOpen, setOpenMobile } = useSidebar();
  const [desktopInfo] = useState(getBbDesktopInfo);
  const [threadShortcutKeysById, setThreadShortcutKeysById] = useState<
    ReadonlyMap<string, SidebarThreadShortcutPresentation>
  >(EMPTY_SIDEBAR_THREAD_SHORTCUT_KEYS);
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const threadShortcutTargetsRef = useRef<
    readonly SidebarThreadShortcutTarget[]
  >([]);
  const isPointerCoarse = usePointerCoarse();
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  const threadJumpShortcuts = useAppCommandShortcuts(
    THREAD_JUMP_APP_COMMAND_IDS,
  );
  const isAppCommandModifierHeld = useIsAppCommandModifierHeld();
  const settingsShortcut = useAppCommandShortcut("settings.open");
  const sidebarNavigation = useSidebarNavigation().data;
  const spaces = useMemo(
    () => sidebarNavigation?.spaces ?? [],
    [sidebarNavigation?.spaces],
  );
  const [activeSpaceId, setActiveSpaceId] = useState(() =>
    typeof localStorage === "undefined"
      ? DEFAULT_SPACE_ID
      : (localStorage.getItem(ACTIVE_SPACE_STORAGE_KEY) ?? DEFAULT_SPACE_ID),
  );
  const [spaceEditor, setSpaceEditor] = useState<SpaceEditorState>(null);
  const [spacePanelDirection, setSpacePanelDirection] =
    useState<SpacePanelDirection>(1);
  const moveProjectMutation = useMoveProjectToSpace();
  const activeSpace =
    spaces.find((space) => space.id === activeSpaceId) ?? spaces[0];
  const effectiveActiveSpaceId = activeSpace?.id ?? activeSpaceId;
  const activeSpaceProjectIds = useMemo(
    () => new Set(activeSpace?.projectIds ?? []),
    [activeSpace?.projectIds],
  );
  const wheelLockUntilRef = useRef(0);

  const setActiveSpaceOnly = useCallback((spaceId: string) => {
    setActiveSpaceId(spaceId);
    localStorage.setItem(ACTIVE_SPACE_STORAGE_KEY, spaceId);
  }, []);

  const switchSpace = useCallback(
    (spaceId: string, requestedDirection?: SpacePanelDirection): boolean => {
      if (!spaces.some((space) => space.id === spaceId)) return false;
      if (spaceId === effectiveActiveSpaceId) return true;
      const currentIndex = spaces.findIndex(
        (space) => space.id === effectiveActiveSpaceId,
      );
      const destinationIndex = spaces.findIndex(
        (space) => space.id === spaceId,
      );
      setSpacePanelDirection(
        requestedDirection ?? (destinationIndex > currentIndex ? 1 : -1),
      );
      const currentLayout = store.get(splitLayoutAtom);
      const currentView: StoredSpaceView = {
        route: `${location.pathname}${location.search}${location.hash}`,
        layout: currentLayout ? serializeSplitLayout(currentLayout) : null,
      };
      sessionStorage.setItem(
        `${SPACE_VIEW_STORAGE_PREFIX}${effectiveActiveSpaceId}`,
        JSON.stringify(currentView),
      );
      setSpaceEditor(null);
      setActiveSpaceOnly(spaceId);
      const destination = readStoredSpaceView(spaceId);
      store.set(
        splitLayoutAtom,
        destination?.layout ? deserializeSplitLayout(destination.layout) : null,
      );
      void navigate(destination?.route ?? getRootComposeRoutePath());
      return true;
    },
    [
      effectiveActiveSpaceId,
      location,
      navigate,
      setActiveSpaceOnly,
      setSpaceEditor,
      spaces,
      store,
    ],
  );

  const activateSpaceShortcut = useCallback(
    (index: number): boolean => {
      const space = spaces[index];
      return space ? switchSpace(space.id) : false;
    },
    [spaces, switchSpace],
  );

  useIndexedAppCommandHandlers(
    SPACE_JUMP_APP_COMMAND_IDS,
    activateSpaceShortcut,
  );

  const handleSpaceWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      const delta =
        Math.abs(event.deltaY) >= Math.abs(event.deltaX)
          ? event.deltaY
          : event.deltaX;
      if (!event.shiftKey || Math.abs(delta) < 12 || spaces.length < 2) return;
      const now = Date.now();
      if (now < wheelLockUntilRef.current) return;
      event.preventDefault();
      wheelLockUntilRef.current = now + 350;
      const currentIndex = Math.max(
        0,
        spaces.findIndex((space) => space.id === effectiveActiveSpaceId),
      );
      const direction = delta > 0 ? 1 : -1;
      const nextIndex =
        (currentIndex + direction + spaces.length) % spaces.length;
      const nextSpace = spaces[nextIndex];
      if (nextSpace) switchSpace(nextSpace.id, direction);
    },
    [effectiveActiveSpaceId, spaces, switchSpace],
  );

  const moveProject = useCallback(
    (projectId: string, spaceId: string) => {
      const sourceSpace = spaces.find((space) =>
        space.projectIds.includes(projectId),
      );
      const destination = spaces.find((space) => space.id === spaceId);
      if (!destination || sourceSpace?.id === destination.id) return;
      moveProjectMutation.mutate(
        { projectId, spaceId },
        {
          onSuccess: () => {
            setActiveSpaceOnly(spaceId);
            appToast.success(`Moved project to ${destination.name}`, {
              action: sourceSpace
                ? {
                    label: "Undo",
                    onClick: () => {
                      moveProjectMutation.mutate({
                        projectId,
                        spaceId: sourceSpace.id,
                      });
                      setActiveSpaceOnly(sourceSpace.id);
                    },
                  }
                : undefined,
            });
          },
        },
      );
    },
    [moveProjectMutation, setActiveSpaceOnly, spaces],
  );

  const moveProjects = useCallback(
    (projectIds: readonly string[], spaceId: string) => {
      const destination = spaces.find((space) => space.id === spaceId);
      if (!destination) return;

      const moves = [...new Set(projectIds)].flatMap((projectId) => {
        const sourceSpace = spaces.find((space) =>
          space.projectIds.includes(projectId),
        );
        return sourceSpace?.id === destination.id
          ? []
          : [{ projectId, sourceSpaceId: sourceSpace?.id ?? null }];
      });
      if (moves.length === 0) return;

      void Promise.all(
        moves.map(({ projectId }) =>
          moveProjectMutation.mutateAsync({ projectId, spaceId }),
        ),
      )
        .then(() => {
          setActiveSpaceOnly(spaceId);
          appToast.success(
            `Moved ${moves.length} ${moves.length === 1 ? "repository" : "repositories"} to ${destination.name}`,
            {
              action: moves.every(({ sourceSpaceId }) => sourceSpaceId)
                ? {
                    label: "Undo",
                    onClick: () => {
                      void Promise.all(
                        moves.map(({ projectId, sourceSpaceId }) =>
                          moveProjectMutation.mutateAsync({
                            projectId,
                            spaceId: sourceSpaceId!,
                          }),
                        ),
                      ).catch(() => undefined);
                    },
                  }
                : undefined,
            },
          );
        })
        .catch(() => undefined);
    },
    [moveProjectMutation, setActiveSpaceOnly, spaces],
  );

  const openSidebarForThreadSearch = useCallback(() => {
    if (isCompactViewport) {
      setOpenMobile(true);
    } else {
      setOpen(true);
    }
  }, [isCompactViewport, setOpen, setOpenMobile]);

  const openSearchedThread = useCallback(
    (item: SidebarThreadSearchNavigationItem) => {
      void navigate(
        getThreadRoutePath({
          projectId: item.projectId,
          threadId: item.threadId,
        }),
        // Hand the matched message's event sequence to the timeline so it can
        // scroll to and briefly highlight that message. Omitted for title-only
        // matches, which just open the thread normally.
        item.messageSeq !== null
          ? {
              state: {
                searchMessageSeq: item.messageSeq,
                searchThreadId: item.threadId,
              },
            }
          : undefined,
      );
    },
    [navigate],
  );

  const threadSearch = useSidebarThreadSearch({
    isPointerCoarse,
    onOpenSidebar: openSidebarForThreadSearch,
    onOpenThread: openSearchedThread,
    onThreadOpened: closeOnMobile,
  });

  const handleNewChat = useCallback(() => {
    closeOnMobile();
    void navigate(getRootComposeRoutePath(), {
      state: { focusPrompt: true },
    });
  }, [closeOnMobile, navigate]);

  const handleCommandCenter = useCallback(() => {
    closeOnMobile();
    if (isRootView) return;

    const state = createSidebarCommandCenterNavigation({
      layout: store.get(splitLayoutAtom),
      returnPath: `${location.pathname}${location.search}${location.hash}`,
    });
    void navigate(
      getRootComposeRoutePath(),
      state === undefined ? undefined : { state },
    );
  }, [closeOnMobile, isRootView, location, navigate, store]);

  const showThreadShortcuts = useCallback(() => {
    const targets = getSidebarThreadShortcutTargets(sidebarRef.current);
    threadShortcutTargetsRef.current = targets;
    setThreadShortcutKeysById(
      new Map(
        targets.flatMap((target, index) => {
          const command = THREAD_JUMP_APP_COMMAND_IDS[index];
          const shortcut = command
            ? threadJumpShortcuts.get(command)
            : undefined;
          return shortcut ? [[target.threadId, shortcut] as const] : [];
        }),
      ),
    );
  }, [threadJumpShortcuts]);

  const hideThreadShortcuts = useCallback(() => {
    threadShortcutTargetsRef.current = [];
    setThreadShortcutKeysById(EMPTY_SIDEBAR_THREAD_SHORTCUT_KEYS);
  }, []);

  const activateThreadShortcut = useCallback((index: number): boolean => {
    const targets = threadShortcutTargetsRef.current;
    const target =
      targets[index] ??
      getSidebarThreadShortcutTargets(sidebarRef.current)[index];
    if (!target?.element) return false;
    target.element.click();
    return true;
  }, []);

  const activateAdjacentThread = useCallback(
    (offset: -1 | 1): boolean => {
      const targets = getSidebarThreadNavigationTargets(sidebarRef.current);
      if (targets.length === 0) return false;
      const activeIndex = targets.findIndex(
        (target) => target.threadId === activeThreadId,
      );
      const nextIndex =
        activeIndex === -1
          ? offset === 1
            ? 0
            : targets.length - 1
          : (activeIndex + offset + targets.length) % targets.length;
      const target = targets[nextIndex];
      if (!target) return false;
      if (target.element) {
        target.element.click();
        return true;
      }
      // The neighbor sits inside a windowed-out placeholder: there is no row
      // to click, so navigate by id, matching what the row's link would do.
      if (!target.projectId) return false;
      closeOnMobile();
      void navigate(
        getThreadRoutePath({
          projectId: target.projectId,
          threadId: target.threadId,
        }),
      );
      return true;
    },
    [activeThreadId, closeOnMobile, navigate],
  );

  useAppCommandHandler("thread.search", () => {
    threadSearch.onActivate();
    return true;
  });
  useIndexedAppCommandHandlers(
    THREAD_JUMP_APP_COMMAND_IDS,
    activateThreadShortcut,
  );
  useAppCommandHandler("thread.previous", () => activateAdjacentThread(-1));
  useAppCommandHandler("thread.next", () => activateAdjacentThread(1));

  useEffect(() => {
    if (isAppCommandModifierHeld) {
      showThreadShortcuts();
      return;
    }
    hideThreadShortcuts();
  }, [hideThreadShortcuts, isAppCommandModifierHeld, showThreadShortcuts]);

  // Keep this object identity stable across unrelated re-renders (opening
  // the mobile drawer flips useSidebar context and re-renders AppSidebar):
  // a fresh object here would defeat ProjectList's memo and re-render every
  // thread group on each drawer toggle.
  const threadSearchPanelController = useMemo(
    () => ({
      activeIndex: threadSearch.activeIndex,
      isActive: threadSearch.isActive,
      onActiveIndexChange: threadSearch.onActiveIndexChange,
      onNavigationItemsChange: threadSearch.onNavigationItemsChange,
      onSelectItem: threadSearch.onSelectItem,
      query: threadSearch.query,
    }),
    [
      threadSearch.activeIndex,
      threadSearch.isActive,
      threadSearch.onActiveIndexChange,
      threadSearch.onNavigationItemsChange,
      threadSearch.onSelectItem,
      threadSearch.query,
    ],
  );

  const builtInThreadList = (
    <ProjectList
      activeSpaceProjectIds={activeSpaceProjectIds}
      onNewProject={
        quickCreateProject.isAvailable
          ? quickCreateProject.openCreateDialog
          : undefined
      }
      onProjectSelect={closeOnMobile}
      isCreatingProject={quickCreateProject.isCreating}
      threadSearch={threadSearchPanelController}
    />
  );

  return (
    <SpaceActionsProvider
      value={{ activeSpaceId: effectiveActiveSpaceId, moveProject, spaces }}
    >
      <SidebarThreadShortcutKeysContext.Provider value={threadShortcutKeysById}>
        <Sidebar
          ref={sidebarRef}
          onKeyDown={threadSearch.onKeyDown}
          onWheel={handleSpaceWheel}
          style={
            activeSpace ? getSpaceSidebarStyle(activeSpace.color) : undefined
          }
        >
          <SpacePanelTransition
            activeSpaceId={effectiveActiveSpaceId}
            direction={spacePanelDirection}
          >
            {showTopReserve ? (
              /* Top reserve that keeps the sidebar's content (New Thread / New
             Projects) anchored below the title-bar chrome, mirroring
             the page-header height on the content side. The sidebar toggle is
             pinned at the app's top-left for every chrome (see AppLayout's
             SidebarTriggerOverlay), so this row hosts no trigger of its own — it
             stays mounted in every sidebar state, including while the panel
             collapses off-canvas, so the content holds its vertical position
             instead of riding up under the pinned toggle during the animation.
             On desktop it doubles as the window-drag strip. The Back/Forward
             route-history controls live on the right of this chrome row, clear
             of the pinned toggle/traffic lights on the left and the resize
             handle on the right; they opt out of the desktop drag region so
             clicks register. */
              <div
                data-testid="app-sidebar-top-reserve-row"
                className={cn(
                  CHROME_ROW_CLASS,
                  "order-[-2] shrink-0 justify-end px-2",
                  usesDesktopChrome && MACOS_WINDOW_DRAG_CLASS,
                )}
              >
                <SidebarHistoryNavigationControls
                  onNavigate={closeOnMobile}
                  className={cn(
                    "group-data-[collapsible=icon]:hidden",
                    usesDesktopChrome && MACOS_CHROME_CONTROL_NO_DRAG_CLASS,
                  )}
                />
              </div>
            ) : null}
            <SidebarUsageLimits />
            <div
              data-testid="app-sidebar-primary-actions"
              className="shrink-0 px-2 py-2.5 group-data-[collapsible=icon]:hidden"
            >
              <ProjectListActionButtons
                splitEnabled={threadSplitsEnabled}
                newThreadSplit={newThreadSplit}
                onNewChat={handleNewChat}
                threadSearch={{
                  activeDescendantId: threadSearch.activeDescendantId,
                  inputRef: threadSearch.inputRef,
                  isActive: threadSearch.isActive,
                  onActivate: threadSearch.onActivate,
                  onClose: threadSearch.onClose,
                  onQueryChange: threadSearch.onQueryChange,
                  query: threadSearch.query,
                }}
              />
            </div>
            <MobileCommandCenterSidebarAction
              isActive={isRootView}
              onSelect={handleCommandCenter}
            />
            <PluginNavSidebarItems
              isCompactViewport={isCompactViewport}
              onNavigate={closeOnMobile}
              splitEnabled={threadSplitsEnabled}
              toolsRoutePath={toolsRoutePath}
            />
            <SidebarContent>
              {spaceEditor ? (
                <SpaceEditor
                  key={
                    spaceEditor.kind === "edit"
                      ? `edit:${spaceEditor.space.id}`
                      : "create"
                  }
                  editor={spaceEditor}
                  spaces={spaces}
                  onCancel={() => setSpaceEditor(null)}
                  onSaved={(spaceId) => {
                    if (spaceId) setActiveSpaceOnly(spaceId);
                    setSpaceEditor(null);
                  }}
                />
              ) : threadListProvider ? (
                <PluginThreadList
                  slot={threadListProvider}
                  builtInFallback={builtInThreadList}
                  searchQuery={threadSearch.query}
                  onNavigate={threadSearch.onExternalThreadOpen}
                  activeSpaceId={effectiveActiveSpaceId}
                  moveProject={moveProject}
                  moveProjects={moveProjects}
                  spaces={spaces}
                />
              ) : (
                builtInThreadList
              )}
            </SidebarContent>
          </SpacePanelTransition>
          <SpaceDock
            activeSpaceId={effectiveActiveSpaceId}
            spaces={spaces}
            onSelect={switchSpace}
            onNew={() => setSpaceEditor({ kind: "create" })}
            onEdit={(space) => setSpaceEditor({ kind: "edit", space })}
          />
          <SidebarFooter className="relative border-t border-sidebar-border/60 bg-sidebar-accent/10">
            <OverflowFade placement="above" tone="sidebar" size="sm" />
            {/* The footer holds a variable number of plugin action buttons, so a
             * narrowed sidebar plus several plugins can no longer fit the action
             * row and the update chips on one line. `flex-wrap-reverse` plus the
             * flexible spacer below handles both layouts without measuring:
             * while everything fits, the spacer stretches and pushes the chips to
             * the right of a single row; once it doesn't, the chips wrap onto
             * their own line, which wrap-reverse renders above the actions, and
             * they sit flush left because the spacer stays behind on the action
             * line. */}
            <SidebarMenu className="flex-row flex-wrap-reverse items-center gap-1">
              <SidebarMenuItem className="min-w-0">
                <SidebarMenuButton
                  asChild
                  aria-label={
                    settingsShortcut
                      ? `Settings (${settingsShortcut.label})`
                      : "Settings"
                  }
                  aria-keyshortcuts={settingsShortcut?.ariaKeyshortcuts}
                  tooltip={{
                    children: settingsShortcut
                      ? `Settings (${settingsShortcut.label})`
                      : "Settings",
                    hidden: false,
                    side: "top",
                  }}
                  className={SIDEBAR_FOOTER_ACTION_CLASS}
                >
                  <Link to={settingsRoutePath} onClick={closeOnMobile}>
                    <Icon name="Settings" />
                    <span className="sr-only">Settings</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <PluginSidebarFooterActions onNavigate={closeOnMobile} />
              <SidebarMenuItem className="min-w-0">
                <SidebarMenuButton
                  className={SIDEBAR_FOOTER_ACTION_CLASS}
                  tooltip={{
                    children: "Report a bug",
                    hidden: false,
                    side: "top",
                  }}
                  aria-label="Report a bug"
                  onClick={() => {
                    closeOnMobile();
                    openUrlInExternalBrowser(BUG_REPORT_NEW_ISSUE_URL);
                  }}
                >
                  <Icon name="Bug" />
                  <span className="sr-only">Report a bug</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <li aria-hidden="true" className="min-w-0 flex-1" />
              <SidebarUpdatesBadge onNavigate={closeOnMobile} />
            </SidebarMenu>
          </SidebarFooter>
          <div
            data-testid="app-sidebar-resize-handle"
            className={cn(
              "absolute -right-1.5 top-0 z-30 hidden h-full w-3 cursor-col-resize md:block",
              "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-transparent before:transition-colors hover:before:bg-sidebar-border",
              "group-data-[collapsible=icon]:hidden",
              isResizing && "before:bg-sidebar-border",
            )}
            onMouseDown={onResizeMouseDown}
          />
        </Sidebar>
      </SidebarThreadShortcutKeysContext.Provider>
    </SpaceActionsProvider>
  );
}
