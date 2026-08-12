import type { ReactNode } from "react";
import type { ThreadListEntry } from "@bb/domain";
import { StoryCard, StoryRow } from "../../.ladle/story-card";
import {
  PROJECT_IDS,
  PROJECT_NAMES,
  makeThreadListEntry,
} from "../../.ladle/story-fixtures";
import { ThreadActionsProvider } from "@/components/thread/ThreadActionsProvider";
import { RootComposeMobileSessions } from "./RootComposeMobileSessions";

export default { title: "views/Mobile Sessions" };

function MobileStage({ children }: { children: ReactNode }) {
  return (
    <div className="root-compose-mobile-sessions-story w-[390px] max-w-full bg-background p-4">
      <style>{`
        @media (min-width: 768px) {
          .root-compose-mobile-sessions-story [data-root-compose-mobile-sessions] {
            display: flex;
          }
        }
      `}</style>
      <ThreadActionsProvider>{children}</ThreadActionsProvider>
    </div>
  );
}

function makeSession(overrides: Partial<ThreadListEntry>): ThreadListEntry {
  return makeThreadListEntry({ projectId: PROJECT_IDS.bb, ...overrides });
}

const sessions = [
  makeSession({
    id: "thr_mobile_pending",
    title: "Approve mobile environment access",
    titleFallback: "Approve mobile environment access",
    environmentId: "env_mobile_activity",
    environmentName: "Activity visualization",
    environmentBranchName: "budah1987/activity-visualization",
    hasPendingInteraction: true,
    pinnedAt: 500,
    status: "active",
    latestAttentionAt: 500,
    runtime: { displayStatus: "active", hostReconnectGraceExpiresAt: null },
  }),
  makeSession({
    id: "thr_mobile_working",
    projectId: PROJECT_IDS.pierre,
    title: "Refine command center session rows",
    titleFallback: "Refine command center session rows",
    status: "active",
    latestAttentionAt: 450,
    runtime: { displayStatus: "active", hostReconnectGraceExpiresAt: null },
  }),
  makeSession({
    id: "thr_mobile_plan",
    title: "Plan touch interaction QA",
    titleFallback: "Plan touch interaction QA",
    status: "active",
    latestAttentionAt: 400,
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 1,
      activeGoalCount: 0,
    },
  }),
  makeSession({
    id: "thr_mobile_awaiting_reply",
    title: "Review mobile navigation",
    titleFallback: "Review mobile navigation",
    status: "idle",
    latestAttentionAt: 350,
    lastReadAt: 351,
    updatedAt: 350,
  }),
  makeSession({
    id: "thr_mobile_idle",
    title: "Previous mobile navigation pass",
    titleFallback: "Previous mobile navigation pass",
    status: "idle",
    latestAttentionAt: 300,
  }),
];

const projectNames = new Map([
  [PROJECT_IDS.bb, PROJECT_NAMES.bb],
  [PROJECT_IDS.pierre, PROJECT_NAMES.pierre],
]);

export function Overview() {
  return (
    <StoryCard labelWidth="170px">
      <StoryRow label="session command center">
        <MobileStage>
          <RootComposeMobileSessions
            highlightedThreadId={null}
            projectNamesById={projectNames}
            showCreatingRow={false}
            threads={sessions}
          />
        </MobileStage>
      </StoryRow>
      <StoryRow label="starting conversation">
        <MobileStage>
          <RootComposeMobileSessions
            highlightedThreadId={null}
            projectNamesById={projectNames}
            showCreatingRow
            threads={sessions}
          />
        </MobileStage>
      </StoryRow>
    </StoryCard>
  );
}
