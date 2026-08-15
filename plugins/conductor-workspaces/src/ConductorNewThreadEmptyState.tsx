import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  experimental_useSidebarThreads as useSidebarThreads,
  useComposer,
  type PluginNewThreadEmptyStateProps,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "../components/ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { ThreadPixelMatrix } from "./PixelMatrix";
import { buildConductorProjection, threadDisplayTitle } from "./projection";
import { loadClosedTabIds } from "./sidebar-preferences";
import { useReconciliation } from "./useReconciliation";

const DESKTOP_FEATURED_TRANSCRIPT_COUNT = 4;
const COMPACT_FEATURED_TRANSCRIPT_COUNT = 2;

export function ConductorNewThreadEmptyState({
  projectId,
  environmentId,
  isCompactViewport,
}: PluginNewThreadEmptyStateProps) {
  const state = useSidebarThreads();
  const composer = useComposer();
  const reconciliation = useReconciliation();
  const revealRef = useRef<HTMLDivElement>(null);
  const [addedTranscriptIds, setAddedTranscriptIds] = useState<Set<string>>(
    () => new Set(),
  );
  const projection = useMemo(
    () =>
      buildConductorProjection(
        state.threads,
        state.projects,
        reconciliation.legacyWorkspaces,
      ),
    [reconciliation.legacyWorkspaces, state.projects, state.threads],
  );
  const project = projection.projects.find(
    (candidate) => candidate.id === projectId,
  );
  const workspace = project?.workspaces.find(
    (candidate) => candidate.environmentId === environmentId,
  );
  const closedTabIds = new Set(
    workspace ? loadClosedTabIds(workspace.key) : [],
  );
  const transcriptThreads =
    workspace?.threads.filter((thread) => !closedTabIds.has(thread.id)) ?? [];
  const featuredCount = isCompactViewport
    ? COMPACT_FEATURED_TRANSCRIPT_COUNT
    : DESKTOP_FEATURED_TRANSCRIPT_COUNT;
  const featuredThreads = transcriptThreads.slice(0, featuredCount);
  const overflowThreads = transcriptThreads.slice(featuredCount);

  useLayoutEffect(() => {
    const block = revealRef.current;
    if (!block) return;
    block.classList.remove("is-hiding", "is-shown");
    void block.offsetHeight;
    block.classList.add("is-shown");
  }, [environmentId]);

  if (!project || !workspace) return null;

  const addTranscript = (thread: PluginSidebarThread) => {
    if (addedTranscriptIds.has(thread.id)) return;
    composer.insertMention({
      provider: "conversation-transcript",
      id: thread.id,
      label: threadDisplayTitle(thread),
    });
    setAddedTranscriptIds((current) => new Set(current).add(thread.id));
  };

  return (
    <section
      ref={revealRef}
      className="conductor-new-thread-stage t-stagger"
      data-compact={isCompactViewport || undefined}
      aria-labelledby="conductor-new-thread-title"
    >
      <div className="conductor-new-thread-copy t-stagger-line t-stagger-line--1">
        <h1 id="conductor-new-thread-title">Start a new conversation</h1>
        <p>
          Begin with a clean context, or carry forward the useful parts of an
          earlier conversation.
        </p>
      </div>

      {transcriptThreads.length > 0 ? (
        <div className="conductor-transcript-library t-stagger-line t-stagger-line--2">
          <div className="conductor-transcript-library-heading">
            <span>Carry forward context</span>
            <span>Optional</span>
          </div>
          <div className="conductor-transcript-library-list">
            {featuredThreads.map((thread) => {
              const isAdded = addedTranscriptIds.has(thread.id);
              const title = threadDisplayTitle(thread);
              return (
                <button
                  key={thread.id}
                  type="button"
                  className="conductor-transcript-chip"
                  data-added={isAdded || undefined}
                  aria-label={`${isAdded ? "Added" : "Add"} transcript from ${title}`}
                  aria-pressed={isAdded}
                  disabled={isAdded}
                  title={title}
                  onClick={() => addTranscript(thread)}
                >
                  <span
                    className="t-icon-swap conductor-transcript-chip-icon"
                    data-state={isAdded ? "b" : "a"}
                    aria-hidden
                  >
                    <span className="t-icon" data-icon="a">
                      <ThreadPixelMatrix thread={thread} />
                    </span>
                    <span className="t-icon" data-icon="b">
                      <Icon name="Check" />
                    </span>
                  </span>
                  <span className="truncate">{title}</span>
                </button>
              );
            })}
            {overflowThreads.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="conductor-transcript-more"
                    aria-label={`${overflowThreads.length} more conversations`}
                  >
                    +{overflowThreads.length} more
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  mobileTitle="Add conversation context"
                  className="w-72 max-w-[calc(100vw-1rem)]"
                >
                  {overflowThreads.map((thread) => {
                    const isAdded = addedTranscriptIds.has(thread.id);
                    return (
                      <DropdownMenuItem
                        key={thread.id}
                        disabled={isAdded}
                        textValue={threadDisplayTitle(thread)}
                        onSelect={() => addTranscript(thread)}
                      >
                        {isAdded ? (
                          <Icon name="Check" aria-hidden />
                        ) : (
                          <ThreadPixelMatrix thread={thread} />
                        )}
                        <span className="truncate">
                          {threadDisplayTitle(thread)}
                        </span>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
