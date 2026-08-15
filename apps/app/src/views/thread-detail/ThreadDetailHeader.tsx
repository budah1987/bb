import {
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Button } from "@bb/shared-ui/button";
import { useAtomValue } from "jotai";
import { COARSE_POINTER_TOOLBAR_ACTION_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { Icon } from "@bb/shared-ui/icon";
import { Pill } from "@bb/shared-ui/pill";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { SplitButton } from "@/components/ui/split-button.js";
import {
  AppPageHeader,
  HEADER_ICON_BUTTON_CLASS,
  HEADER_PANE_ACTION_ICON_BUTTON_CLASS,
} from "@/components/layout/AppPageHeader";
import {
  getBbDesktopInfo,
  MACOS_WINDOW_NO_DRAG_CLASS,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import { cn } from "@bb/shared-ui/lib/utils";
import { useIsRailVisible, useToggleRail } from "@/lib/rail-visibility";
import { useAppCommandShortcut } from "@/components/commands/AppCommandProvider";
import { AppCommandShortcutHint } from "@/components/commands/AppCommandShortcutHint";
import { useInlineThreadTitle } from "@/components/thread/InlineThreadTitle";
import { useThreadActions } from "@/components/thread/ThreadActionsProvider";
import { ThreadTitleMentions } from "@/components/thread/ThreadTitleMentions";
import { SecondaryPanelHostLayoutContext } from "@/components/secondary-panel/SecondaryPanelHostLayoutContext";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@/components/ui/chromeStyleTokens";
import { dimInactiveSplitsAtom } from "@/lib/split-layout/atoms";
import {
  CONTEXT_INACTIVE_TEXT_CLASS,
  CONTEXT_SELECTION_SURFACE_CLASS,
} from "@/components/ui/context-selection";
import { usePaneContext } from "./PaneContext";
import { PaneMaximizeButton } from "./PaneMaximizeButton";

const THREAD_HEADER_ACTION_BUTTON_CLASS = cn(
  COARSE_POINTER_TOOLBAR_ACTION_BUTTON_CLASS,
  "border-border/70 bg-transparent font-normal hover:bg-state-hover",
);
const NARROW_SPLIT_HEADER_MAX_WIDTH = 560;

export interface ThreadHeaderWorkflowAction {
  disabled?: boolean;
  label: string;
  onSelect: () => void;
  tooltip?: string;
}

interface ThreadHeaderContext {
  branchName?: string;
  projectName: string;
}

interface ThreadDetailHeaderProps {
  /**
   * Renders the thread menu. Responsive header actions belong in the menu only
   * while a narrow split hides their inline controls.
   */
  actionsMenu: ((includeResponsiveActions: boolean) => ReactNode) | null;
  /** Pill shown beside the title for side chats and hierarchical child threads. */
  childPillLabel: "child" | "side chat" | null;
  isSecondaryPanelOpen: boolean;
  /** Closes this pane; only provided when the layout is split (>1 pane). */
  onClosePane?: () => void;
  onToggleSecondaryPanel: () => void;
  /** Plugin-contributed thread action buttons (design §4.9); optional. */
  pluginActions?: ReactNode;
  /**
   * Project and branch replace the conversation title when the selected
   * sidebar provider renders that title in its thread context bar.
   */
  threadContext?: ThreadHeaderContext;
  threadHeaderWorkflowActions: readonly ThreadHeaderWorkflowAction[];
  threadId: string;
  threadTitle: string;
  workspaceOpenButton?: ReactNode;
}

export function ThreadDetailHeader({
  actionsMenu,
  childPillLabel,
  isSecondaryPanelOpen,
  onClosePane,
  onToggleSecondaryPanel,
  pluginActions,
  threadContext,
  threadHeaderWorkflowActions,
  threadId,
  threadTitle,
  workspaceOpenButton,
}: ThreadDetailHeaderProps) {
  const [primaryAction, ...secondaryActions] = threadHeaderWorkflowActions;
  const { renameThread } = useThreadActions();
  const handleRename = useCallback(
    (nextTitle: string) => {
      renameThread(threadId, nextTitle);
    },
    [renameThread, threadId],
  );
  const { editor, isEditing, startEditing } = useInlineThreadTitle({
    onCommit: handleRename,
    resetKey: threadId,
    title: threadTitle,
  });
  const renderAsDrawer = useIsCompactViewport();
  const [desktopInfo] = useState(getBbDesktopInfo);
  const dimsInactiveSplits = useAtomValue(dimInactiveSplitsAtom);
  const panelShortcut = useAppCommandShortcut("panel.toggle");
  const railShortcut = useAppCommandShortcut("rail.toggle");
  const isRailVisible = useIsRailVisible();
  const toggleRail = useToggleRail();
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  const headerRef = useRef<HTMLElement>(null!);
  // The title doubles as the pane-reorder drag handle when the layout is split;
  // beginPaneDrag is undefined on the single-pane and page surfaces.
  const {
    beginPaneDrag,
    isFocused,
    isTopRow,
    ownsWindowTopLeft,
    reservesWindowPanelToggle,
    secondaryPanelHost,
  } = usePaneContext();
  const isWindowPanelOpen =
    useContext(SecondaryPanelHostLayoutContext)?.isOpen === true;
  const isSplitPaneHeader = beginPaneDrag !== undefined;
  const [measuredPaneWidth, setMeasuredPaneWidth] = useState(0);
  const usesResponsiveActionOverflow =
    isSplitPaneHeader &&
    measuredPaneWidth > 0 &&
    measuredPaneWidth < NARROW_SPLIT_HEADER_MAX_WIDTH;
  const usesResponsiveActionMenu =
    renderAsDrawer || usesResponsiveActionOverflow;
  useLayoutEffect(() => {
    if (!isSplitPaneHeader) {
      return;
    }

    const header = headerRef.current;
    const pane = header.closest<HTMLElement>("[data-split-pane-id]");
    const measuredElement = pane ?? header;
    const measure = () => {
      const width = measuredElement.getBoundingClientRect().width;
      if (width > 0) {
        setMeasuredPaneWidth(width);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(measuredElement);
    return () => {
      observer.disconnect();
    };
  }, [isSplitPaneHeader]);
  const handleTitlePointerDown = (event: ReactPointerEvent) => {
    if (isEditing || !beginPaneDrag || event.button !== 0) {
      return;
    }
    beginPaneDrag(event, threadTitle);
  };
  const handleTitleDoubleClick = () => {
    if (isEditing) {
      return;
    }
    startEditing();
  };
  const rightPanelLabel = isSecondaryPanelOpen
    ? "Hide right panel"
    : "Show right panel";
  const rightPanelIconName = renderAsDrawer ? "PanelBottom" : "PanelRight";
  // The thread header owns only the show control. Once the panel opens, its
  // toolbar owns collapse so pane actions (including Full Screen) keep their
  // stable positions in the thread header.
  const showRightPanelToggle =
    secondaryPanelHost === null && !isSecondaryPanelOpen;
  const rendersThreadContext = threadContext !== undefined;
  const threadContextLabel = [
    threadContext ? `Project: ${threadContext.projectName}` : null,
    threadContext?.branchName ? `Branch: ${threadContext.branchName}` : null,
  ]
    .filter((label): label is string => label !== null)
    .join(", ");
  const railLabel = isRailVisible ? "Hide rail" : "Show rail";
  // Unlike the panel toggle, this one stays put whether the rail is showing or
  // not: the rail carries no chrome of its own to hide itself from, so the
  // header owns both directions.
  const showRailToggle = secondaryPanelHost === null && !renderAsDrawer;

  const center = (
    <>
      <div
        data-pane-header-focus-tab={
          isSplitPaneHeader && isFocused ? "" : undefined
        }
        className={cn(
          "relative min-w-0",
          isSplitPaneHeader && "-mx-2 -my-1 rounded-md px-2 py-1",
          isSplitPaneHeader && isFocused && CONTEXT_SELECTION_SURFACE_CLASS,
        )}
      >
        {rendersThreadContext ? (
          <div
            role="group"
            aria-label={threadContextLabel || "Thread context"}
            className={cn(
              "relative flex min-w-0 items-center gap-2 text-sm font-normal transition-colors",
              isSplitPaneHeader &&
                !isFocused &&
                dimsInactiveSplits &&
                CONTEXT_INACTIVE_TEXT_CLASS,
              beginPaneDrag &&
                cn(
                  "cursor-grab touch-none select-none",
                  // Opt the drag handle out of the macOS title-bar drag region so a
                  // pane-reorder gesture isn't swallowed as a window drag.
                  usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
                ),
            )}
            onPointerDown={beginPaneDrag ? handleTitlePointerDown : undefined}
          >
            {threadContext ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <Icon name="Folder" className="size-3.5 shrink-0" aria-hidden />
                <span
                  className="min-w-0 truncate"
                  title={`Project: ${threadContext.projectName}`}
                >
                  {threadContext.projectName}
                </span>
              </span>
            ) : null}
            {threadContext?.branchName ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <Icon
                  name="GitBranch"
                  className="size-3.5 shrink-0"
                  aria-hidden
                />
                <span
                  className="min-w-0 truncate"
                  title={`Branch: ${threadContext.branchName}`}
                >
                  {threadContext.branchName}
                </span>
              </span>
            ) : null}
          </div>
        ) : (
          <p
            className={cn(
              "relative min-w-0 text-sm font-normal transition-colors",
              isEditing ? "overflow-visible" : "truncate",
              isSplitPaneHeader &&
                !isFocused &&
                dimsInactiveSplits &&
                CONTEXT_INACTIVE_TEXT_CLASS,
              beginPaneDrag &&
                !isEditing &&
                cn(
                  "cursor-grab touch-none select-none",
                  // Opt the drag handle out of the macOS title-bar drag region so a
                  // pane-reorder gesture isn't swallowed as a window drag.
                  usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
                ),
            )}
            onDoubleClick={handleTitleDoubleClick}
            onPointerDown={beginPaneDrag ? handleTitlePointerDown : undefined}
          >
            {isEditing ? editor : <ThreadTitleMentions title={threadTitle} />}
          </p>
        )}
      </div>
      {childPillLabel ? (
        <Pill variant="outline" size="sm">
          {childPillLabel}
        </Pill>
      ) : null}
      {/*
        The header's center slot sits inside the macOS title-bar drag region
        (AppPageHeader only exempts the actions slot), so the interactive
        actions menu must opt out of dragging or its clicks are swallowed as
        window drags. Gated on desktop chrome like every other no-drag site —
        the class also carries `relative z-50`, which must not leak into the
        web build.
      */}
      {actionsMenu == null ? null : (
        <span
          data-testid="thread-detail-header-actions-menu"
          className={cn(
            "flex items-center",
            usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
          )}
        >
          {actionsMenu(usesResponsiveActionMenu)}
        </span>
      )}
    </>
  );

  const actions = (
    <>
      <div
        className="flex min-w-7 items-center gap-1"
        data-thread-header-workflow-actions=""
      >
        {pluginActions}
        {!usesResponsiveActionMenu && workspaceOpenButton ? (
          <span className="inline-flex" data-thread-header-responsive-action="">
            {workspaceOpenButton}
          </span>
        ) : null}
        {!usesResponsiveActionMenu && primaryAction ? (
          <span
            className="inline-flex"
            data-thread-header-responsive-action=""
            title={primaryAction.tooltip}
          >
            {secondaryActions.length > 0 ? (
              <SplitButton
                className={THREAD_HEADER_ACTION_BUTTON_CLASS}
                disabled={primaryAction.disabled}
                primaryAction={{
                  label: primaryAction.label,
                  onSelect: primaryAction.onSelect,
                }}
                secondaryActions={secondaryActions.map((action) => ({
                  label: action.label,
                  onSelect: action.onSelect,
                }))}
                primaryTooltip={primaryAction.tooltip}
              />
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={THREAD_HEADER_ACTION_BUTTON_CLASS}
                disabled={primaryAction.disabled}
                onClick={primaryAction.onSelect}
              >
                {primaryAction.label}
              </Button>
            )}
          </span>
        ) : null}
      </div>
      <div
        className="ml-1 flex items-center gap-0.5"
        data-thread-header-pane-actions=""
      >
        {showRailToggle ? (
          <span
            className={cn(
              "inline-flex items-center gap-1.5",
              // The row's own gap-0.5 is 2px; 6px more makes the 8px the rail
              // and panel toggles are meant to read as a pair across. Only
              // while the panel toggle is actually there to pair with.
              showRightPanelToggle && "mr-1.5",
            )}
          >
            <AppCommandShortcutHint shortcut={railShortcut} />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                HEADER_ICON_BUTTON_CLASS,
                CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS,
              )}
              aria-label={
                railShortcut
                  ? `${railLabel} (${railShortcut.label})`
                  : railLabel
              }
              aria-keyshortcuts={railShortcut?.ariaKeyshortcuts}
              aria-pressed={isRailVisible}
              onClick={toggleRail}
            >
              <Icon name="ListView" />
            </Button>
          </span>
        ) : null}
        {showRightPanelToggle ? (
          <span className="inline-flex items-center gap-1.5">
            <AppCommandShortcutHint shortcut={panelShortcut} />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                HEADER_ICON_BUTTON_CLASS,
                CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS,
              )}
              aria-label={
                panelShortcut
                  ? `${rightPanelLabel} (${panelShortcut.label})`
                  : rightPanelLabel
              }
              aria-keyshortcuts={panelShortcut?.ariaKeyshortcuts}
              aria-expanded={isSecondaryPanelOpen}
              onClick={onToggleSecondaryPanel}
            >
              <Icon name={rightPanelIconName} />
            </Button>
          </span>
        ) : null}
        <PaneMaximizeButton />
        {onClosePane ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              HEADER_PANE_ACTION_ICON_BUTTON_CLASS,
              CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS,
            )}
            aria-label="Close pane"
            onClick={onClosePane}
          >
            <Icon name="CloseThreadPane" />
          </Button>
        ) : null}
        {reservesWindowPanelToggle && !isWindowPanelOpen ? (
          // Reserve only the fixed 28px corner button. Its modifier-held hint is
          // positioned below the chrome row by the workspace host, so it never
          // consumes or covers this pane-action row. With the window panel open,
          // the toggle overlays the panel's own chrome instead, so the pane
          // actions sit flush at the pane edge.
          <span aria-hidden className={HEADER_ICON_BUTTON_CLASS} />
        ) : null}
      </div>
    </>
  );

  return (
    <AppPageHeader
      headerRef={headerRef}
      center={center}
      actions={actions}
      isWindowDragRegion={isTopRow}
      ownsWindowTopLeft={ownsWindowTopLeft}
      className={beginPaneDrag ? "z-[21]" : undefined}
    />
  );
}
