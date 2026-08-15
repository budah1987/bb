// bb-plugin-github — the frontend bundle.
//
// A GitHub panel: Issues / Pull Requests as a filterable table (state chips,
// "Assigned to me", text search), inline status + assignee editing, issue and
// pull-request detail views with a metadata sidebar (the PR view covers
// checks, reviews, inline review threads, and per-file diffs — VS Code's
// GitHub integration, shrunk to a panel). Selecting an issue or PR is
// read-only; its detail view can open or start a BB conversation. The navPanel
// owns /plugins/github/github/* through subPath routing. A threadPanelAction
// opens the same PR view in a thread's right panel, auto-resolved to that
// thread's PR.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  definePluginApp,
  useBbNavigate,
  useRealtime,
  useRpc,
  type PluginNavPanelProps,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import type { githubRpcContract } from "./server.js";
// Shimmed to the host's copy at build time (shared worker-pool context +
// shiki stays out of the plugin bundle) — diffs render with the same syntax
// highlighting as the app's own diff panel.
import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import { FileDiff as PierreFileDiff } from "@pierre/diffs/react";
import { toast } from "sonner";
import { z } from "zod";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Input } from "@bb/shared-ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bb/shared-ui/select";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@bb/shared-ui/tabs";
import { Textarea } from "@bb/shared-ui/textarea";
import { EmptyState } from "@/components/empty-state";
import { Markdown } from "@/components/markdown-lite";
import { PageBody } from "@/components/page-body";

interface Item {
  repo: string;
  number: number;
  kind: "issue" | "pr";
  title: string;
  state: string;
  author: string;
  labels: string[];
  assignees: string[];
  url: string;
  body: string;
  updatedAt: string;
}

interface IssueComment {
  author: string;
  body: string;
  createdAt: string;
}

interface IssueDetail extends Omit<Item, "kind"> {
  comments: IssueComment[];
}

interface PullCheck {
  name: string;
  status: "success" | "failure" | "pending" | "neutral";
  url: string;
}

interface PullReview {
  author: string;
  state: string;
  body: string;
  createdAt: string;
}

interface ReviewThread {
  path: string;
  line: number | null;
  diffHunk: string;
  comments: IssueComment[];
}

interface PullFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

interface PullSummary {
  repo: string;
  number: number;
  title: string;
  state: string; // OPEN | DRAFT | MERGED | CLOSED
  author: string;
  body: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  baseRefName: string;
  headRefName: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  labels: string[];
  assignees: string[];
  reviewDecision: string;
  mergeStateStatus: string;
  reviewRequests: string[];
  checks: PullCheck[];
}

interface PullActivity {
  comments: IssueComment[];
  reviews: PullReview[];
  reviewThreads: ReviewThread[];
}

interface RepoInfo {
  repo: string;
  projectId: string;
  githubAccountLogin: string | null;
  available: boolean;
  unavailableReason: string | null;
}

interface ThreadLink {
  kind: "issue" | "pr";
  repo: string;
  number: number;
  threadId: string;
  createdAt: string;
}

type LinksMap = Record<string, ThreadLink[]>;

const commentCacheSchema = z.object({
  author: z.string(),
  body: z.string(),
  createdAt: z.string(),
});
const itemCacheSchema = z.object({
  repo: z.string(),
  number: z.number(),
  kind: z.enum(["issue", "pr"]),
  title: z.string(),
  state: z.string(),
  author: z.string(),
  labels: z.array(z.string()),
  assignees: z.array(z.string()),
  url: z.string(),
  body: z.string(),
  updatedAt: z.string(),
});
const issueDetailCacheSchema = itemCacheSchema.omit({ kind: true }).extend({
  comments: z.array(commentCacheSchema),
});
const pullCheckCacheSchema = z.object({
  name: z.string(),
  status: z.enum(["success", "failure", "pending", "neutral"]),
  url: z.string(),
});
const pullSummaryCacheSchema = z.object({
  repo: z.string(),
  number: z.number(),
  title: z.string(),
  state: z.string(),
  author: z.string(),
  body: z.string(),
  url: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  baseRefName: z.string(),
  headRefName: z.string(),
  additions: z.number(),
  deletions: z.number(),
  changedFiles: z.number(),
  labels: z.array(z.string()),
  assignees: z.array(z.string()),
  reviewDecision: z.string(),
  mergeStateStatus: z.string(),
  reviewRequests: z.array(z.string()),
  checks: z.array(pullCheckCacheSchema),
});
const pullReviewCacheSchema = z.object({
  author: z.string(),
  state: z.string(),
  body: z.string(),
  createdAt: z.string(),
});
const reviewThreadCacheSchema = z.object({
  path: z.string(),
  line: z.number().nullable(),
  diffHunk: z.string(),
  comments: z.array(commentCacheSchema),
});
const pullActivityCacheSchema = z.object({
  comments: z.array(commentCacheSchema),
  reviews: z.array(pullReviewCacheSchema),
  reviewThreads: z.array(reviewThreadCacheSchema),
});
const pullFileCacheSchema = z.object({
  path: z.string(),
  status: z.string(),
  additions: z.number(),
  deletions: z.number(),
  patch: z.string().nullable(),
});
const repoInfoCacheSchema = z.object({
  repo: z.string(),
  projectId: z.string(),
  githubAccountLogin: z.string().nullable(),
  available: z.boolean(),
  unavailableReason: z.string().nullable(),
});
const statusCacheSchema = z.object({
  ghOk: z.boolean(),
  ghError: z.string().nullable(),
  repos: z.array(repoInfoCacheSchema),
  lastSyncedAt: z.string().nullable(),
});

const READ_CACHE_KEY = "bb-plugin-github:read-cache:v2";
const LAST_VIEWER_KEY = "bb-plugin-github:last-viewer:v1";
const READ_CACHE_MAX_ENTRIES = 48;
const READ_CACHE_MAX_CHARS = 400_000;
const READ_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

interface ReadCacheEntry {
  savedAt: number;
  accountLogin: string;
  data: unknown;
}

function readCacheEntries(): Record<string, ReadCacheEntry> {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(READ_CACHE_KEY) ?? "null",
    );
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const entries = (parsed as { entries?: unknown }).entries;
    if (
      entries === null ||
      typeof entries !== "object" ||
      Array.isArray(entries)
    )
      return {};
    const valid: Record<string, ReadCacheEntry> = {};
    for (const [key, value] of Object.entries(entries)) {
      if (value === null || typeof value !== "object" || Array.isArray(value))
        continue;
      const candidate = value as Partial<ReadCacheEntry>;
      if (
        typeof candidate.savedAt !== "number" ||
        typeof candidate.accountLogin !== "string"
      ) {
        continue;
      }
      valid[key] = {
        savedAt: candidate.savedAt,
        accountLogin: candidate.accountLogin,
        data: candidate.data,
      };
    }
    return valid;
  } catch {
    return {};
  }
}

function readCachedValue<T>(
  key: string,
  accountLogin: string | null,
  schema: z.ZodType<T>,
): T | null {
  if (accountLogin === null) return null;
  const entry = readCacheEntries()[`${accountLogin}:${key}`];
  if (
    entry === undefined ||
    entry.accountLogin !== accountLogin ||
    !Number.isFinite(entry.savedAt) ||
    Date.now() - entry.savedAt > READ_CACHE_MAX_AGE_MS
  ) {
    return null;
  }
  const parsed = schema.safeParse(entry.data);
  return parsed.success ? parsed.data : null;
}

function writeCachedValue(
  key: string,
  accountLogin: string | null,
  data: unknown,
): void {
  if (accountLogin === null) return;
  try {
    const scopedKey = `${accountLogin}:${key}`;
    const now = Date.now();
    const entries = Object.entries(readCacheEntries())
      .filter(([, entry]) => now - entry.savedAt <= READ_CACHE_MAX_AGE_MS)
      .sort(([, a], [, b]) => b.savedAt - a.savedAt);
    const next: Record<string, ReadCacheEntry> = {
      [scopedKey]: { savedAt: now, accountLogin, data },
    };
    for (const [entryKey, entry] of entries) {
      if (
        entryKey === scopedKey ||
        Object.keys(next).length >= READ_CACHE_MAX_ENTRIES
      )
        continue;
      next[entryKey] = entry;
      if (JSON.stringify({ entries: next }).length > READ_CACHE_MAX_CHARS) {
        delete next[entryKey];
        break;
      }
    }
    const serialized = JSON.stringify({ entries: next });
    if (serialized.length <= READ_CACHE_MAX_CHARS) {
      window.localStorage.setItem(READ_CACHE_KEY, serialized);
    }
  } catch {
    // Storage can be unavailable in private mode or full; reads still work live.
  }
}

function readLastViewerLogin(): string | null {
  try {
    const login =
      window.localStorage.getItem(LAST_VIEWER_KEY)?.trim().toLowerCase() ?? "";
    return /^[a-z0-9](?:[a-z0-9-]{0,38})$/.test(login) ? login : null;
  } catch {
    return null;
  }
}

function writeLastViewerLogin(login: string): void {
  try {
    window.localStorage.setItem(LAST_VIEWER_KEY, login);
  } catch {
    // Live data remains available when persistent storage is unavailable.
  }
}

function asItems(result: unknown): Item[] {
  const items = (result as { items?: unknown })?.items;
  return Array.isArray(items) ? (items as Item[]) : [];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function accountSwitchGuidance(repo: RepoInfo): string {
  if (repo.available) return "";
  const reason =
    repo.unavailableReason ??
    "This repository is unavailable to the active GitHub account.";
  return repo.githubAccountLogin === null
    ? `${reason} Authenticate GitHub CLI, then refresh.`
    : `${reason} Run gh auth switch --user ${repo.githubAccountLogin}, then refresh.`;
}

function RepositoryUnavailableNotice({ repo }: { repo: RepoInfo }) {
  if (repo.available) return null;
  return (
    <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
      <span className="font-medium text-foreground">
        {repo.repo} is unavailable.
      </span>{" "}
      {accountSwitchGuidance(repo)}
    </div>
  );
}

function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, (Date.now() - then) / 1000);
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// ---------------------------------------------------------------------------
// Sub-routing — the navPanel owns /plugins/github/github/*, so sub-navigation
// lives in the route's subPath: "issues", "pulls", "new",
// "issues/<owner>/<repo>/<number>". Deep-linkable, and browser back/forward
// walks panel history.
// ---------------------------------------------------------------------------

const PANEL_PATH = "github";

type Route =
  | { view: "issues" }
  | { view: "pulls" }
  | { view: "new" }
  | { view: "issue"; repo: string; number: number }
  | { view: "pull"; repo: string; number: number };

function parseSubPath(subPath: string): Route {
  const parts = subPath.split("/").filter((p) => p.length > 0);
  if (parts[0] === "pulls" && parts.length === 4) {
    const number = Number(parts[3]);
    if (Number.isFinite(number)) {
      return { view: "pull", repo: `${parts[1]}/${parts[2]}`, number };
    }
  }
  if (parts[0] === "pulls") return { view: "pulls" };
  if (parts[0] === "new") return { view: "new" };
  if (parts[0] === "issues" && parts.length === 4) {
    const number = Number(parts[3]);
    if (Number.isFinite(number)) {
      return { view: "issue", repo: `${parts[1]}/${parts[2]}`, number };
    }
  }
  return { view: "issues" };
}

function routeToSubPath(route: Route): string {
  switch (route.view) {
    case "issues":
      return "issues";
    case "pulls":
      return "pulls";
    case "new":
      return "new";
    case "issue":
      return `issues/${route.repo}/${route.number}`;
    case "pull":
      return `pulls/${route.repo}/${route.number}`;
  }
}

function useSubPathRoute(subPath: string): [Route, (route: Route) => void] {
  const bbNavigate = useBbNavigate();
  const route = useMemo(() => parseSubPath(subPath), [subPath]);
  const navigate = useCallback(
    (next: Route) => {
      bbNavigate.toPluginPanel(PANEL_PATH, { subPath: routeToSubPath(next) });
    },
    [bbNavigate],
  );
  return [route, navigate];
}

// ---------------------------------------------------------------------------
// Data hooks.
// ---------------------------------------------------------------------------

// All cached items of a kind — filtering happens client-side in the filter
// bar's query engine, so keystrokes never round-trip to the server.
function useItems(kind: "issue" | "pr"): {
  items: Item[] | null;
  error: string | null;
} {
  const rpc = useRpc<typeof githubRpcContract>();
  const { login: viewer, phase: viewerPhase } = useViewerIdentity();
  const viewerVerified = viewerPhase === "verified";
  const [state, setState] = useState<{
    items: Item[] | null;
    error: string | null;
  }>({
    items: null,
    error: null,
  });
  const refetch = useCallback(() => {
    if (!viewerVerified) return;
    rpc.call("listItems", { kind }).then(
      (result) => {
        const items = asItems(result).slice(0, 250);
        setState({ items, error: null });
        writeCachedValue(`list:${kind}`, viewer, items);
      },
      (error: unknown) =>
        setState((previous) => ({
          items: previous.items,
          error: errorText(error),
        })),
    );
  }, [rpc, kind, viewer, viewerVerified]);
  useEffect(() => {
    const cached =
      viewerPhase === "pending"
        ? null
        : readCachedValue(`list:${kind}`, viewer, z.array(itemCacheSchema));
    setState({ items: cached, error: null });
    if (viewerVerified) refetch();
  }, [kind, viewer, viewerPhase, viewerVerified, refetch]);
  useRealtime("data-changed", refetch);
  return state;
}

function useLinks(): LinksMap {
  const rpc = useRpc<typeof githubRpcContract>();
  const [links, setLinks] = useState<LinksMap>({});
  const refetch = useCallback(() => {
    rpc.call("listLinks").then(
      (result) => {
        const map = (result as { links?: unknown })?.links;
        if (map !== null && typeof map === "object") setLinks(map as LinksMap);
      },
      () => {},
    );
  }, [rpc]);
  useEffect(() => {
    refetch();
  }, [refetch]);
  useRealtime("links-changed", refetch);
  return links;
}

function useSpawn(): {
  spawn: (
    method: "startWork" | "startReview",
    repo: string,
    number: number,
  ) => void;
  spawningKey: string | null;
} {
  const rpc = useRpc<typeof githubRpcContract>();
  const navigate = useBbNavigate();
  const [spawningKey, setSpawningKey] = useState<string | null>(null);
  const spawn = useCallback(
    (method: "startWork" | "startReview", repo: string, number: number) => {
      setSpawningKey(`${repo}#${number}`);
      rpc
        .call(method, { repo, number })
        .then((result) => {
          const { threadId, created } = result as {
            threadId?: unknown;
            created?: unknown;
          };
          if (typeof threadId !== "string")
            throw new Error("malformed spawn result");
          if (created === true) toast.success(`Workspace created in ${repo}`);
          navigate.toThread(threadId);
        })
        .catch((error: unknown) => toast.error(errorText(error)))
        .finally(() => setSpawningKey(null));
    },
    [rpc, navigate],
  );
  return { spawn, spawningKey };
}

type ViewerPhase = "pending" | "verified" | "offline";
interface ViewerSnapshot {
  login: string | null;
  phase: ViewerPhase;
}

let viewerSnapshot: ViewerSnapshot = {
  login: readLastViewerLogin(),
  phase: "pending",
};
let viewerInitialized = false;
let viewerInFlight = false;
const viewerListeners = new Set<() => void>();

function updateViewerSnapshot(next: ViewerSnapshot): void {
  viewerSnapshot = next;
  for (const listener of viewerListeners) listener();
}

function refreshViewer(
  fetchViewer: () => Promise<unknown>,
  force = false,
): void {
  if (viewerInFlight || (viewerInitialized && !force)) return;
  viewerInitialized = true;
  viewerInFlight = true;
  updateViewerSnapshot({ ...viewerSnapshot, phase: "pending" });
  fetchViewer()
    .then(
      (result) => {
        const value = (result as { login?: unknown })?.login;
        const login =
          typeof value === "string" ? value.trim().toLowerCase() : "";
        if (/^[a-z0-9](?:[a-z0-9-]{0,38})$/.test(login)) {
          writeLastViewerLogin(login);
          updateViewerSnapshot({ login, phase: "verified" });
        } else {
          updateViewerSnapshot({ ...viewerSnapshot, phase: "offline" });
        }
      },
      () => updateViewerSnapshot({ ...viewerSnapshot, phase: "offline" }),
    )
    .finally(() => {
      viewerInFlight = false;
    });
}

function useViewerIdentity(): ViewerSnapshot {
  const rpc = useRpc<typeof githubRpcContract>();
  useEffect(() => {
    refreshViewer(() => rpc.call("viewer"));
  }, [rpc]);
  return useSyncExternalStore(
    (listener) => {
      viewerListeners.add(listener);
      return () => viewerListeners.delete(listener);
    },
    () => viewerSnapshot,
    () => viewerSnapshot,
  );
}

function useViewer(): string | null {
  return useViewerIdentity().login;
}

// ---------------------------------------------------------------------------
// Shared bits.
// ---------------------------------------------------------------------------

/** GitHub avatar by login — github.com serves these without auth. */
function Avatar({
  login,
  size = "size-5",
  className,
}: {
  login: string;
  size?: string;
  className?: string;
}) {
  return (
    <img
      src={`https://github.com/${encodeURIComponent(login)}.png?size=64`}
      alt={login}
      title={login}
      loading="lazy"
      className={`${size} shrink-0 rounded-full bg-muted ${className ?? ""}`}
    />
  );
}

function ChevronDownIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 opacity-50"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 0 0-15.2-6.5L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 15.2 6.5L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  );
}

function stateDotClass(kind: "issue" | "pr", state: string): string {
  if (state === "OPEN") return "bg-green-500";
  if (kind === "pr" && state === "MERGED") return "bg-purple-500";
  if (kind === "pr") return "bg-red-500";
  return "bg-purple-500";
}

function StateDot({ kind, state }: { kind: "issue" | "pr"; state: string }) {
  return (
    <span
      className={`size-2 shrink-0 rounded-full ${stateDotClass(kind, state)}`}
    />
  );
}

function StateBadge({ kind, state }: { kind: "issue" | "pr"; state: string }) {
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <StateDot kind={kind} state={state} />
      {state.toLowerCase()}
    </Badge>
  );
}

function ThreadPills({ links }: { links: ThreadLink[] | undefined }) {
  const { spawn, spawningKey } = useSpawn();
  if (links === undefined || links.length === 0) return null;
  const latest = [...links].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  )[0];
  if (latest === undefined) return null;
  return (
    <button
      type="button"
      title={`Open ${links.length === 1 ? "conversation" : "latest conversation"}`}
      onClick={(event) => {
        event.stopPropagation();
        spawn(
          latest.kind === "issue" ? "startWork" : "startReview",
          latest.repo,
          latest.number,
        );
      }}
      disabled={spawningKey !== null}
      className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md bg-secondary px-2 text-xs font-medium tabular-nums text-secondary-foreground hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:min-h-10"
    >
      <span
        className="size-1.5 rounded-full bg-foreground/45"
        aria-hidden="true"
      />
      {spawningKey === `${latest.repo}#${latest.number}`
        ? "Opening…"
        : links.length === 1
          ? "Conversation"
          : `${links.length} conversations`}
    </button>
  );
}

function preferredLink(links: ThreadLink[] | undefined): ThreadLink | null {
  if (links === undefined || links.length === 0) return null;
  return (
    [...links].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    )[0] ?? null
  );
}

function ConversationAction({
  kind,
  repo,
  number,
  links,
  available,
  className,
}: {
  kind: "issue" | "pr";
  repo: string;
  number: number;
  links: ThreadLink[] | undefined;
  available: boolean;
  className?: string;
}) {
  const { spawn, spawningKey } = useSpawn();
  const existing = preferredLink(links);
  const busy = spawningKey === `${repo}#${number}`;
  return (
    <Button
      className={className}
      disabled={(existing === null && !available) || spawningKey !== null}
      onClick={() =>
        spawn(kind === "issue" ? "startWork" : "startReview", repo, number)
      }
    >
      {busy
        ? "Opening conversation…"
        : existing !== null
          ? "Open conversation"
          : "Start conversation"}
    </Button>
  );
}

function MobileConversationBar({
  kind,
  repo,
  number,
  links,
  available,
}: {
  kind: "issue" | "pr";
  repo: string;
  number: number;
  links: ThreadLink[] | undefined;
  available: boolean;
}) {
  const existing = preferredLink(links);
  return (
    <div className="sticky top-0 z-20 -mx-3 border-y border-border bg-background/95 px-3 py-3 backdrop-blur sm:hidden">
      <ConversationAction
        kind={kind}
        repo={repo}
        number={number}
        links={links}
        available={available}
        className="min-h-11 w-full"
      />
      <p className="mt-1.5 text-center text-xs text-muted-foreground">
        {existing !== null
          ? "Returns to the existing workspace"
          : !available
            ? "Switch GitHub accounts to start a conversation"
            : `Creates a workspace in ${repo}`}
      </p>
    </div>
  );
}

function LabelChips({
  labels,
  className,
}: {
  labels: string[];
  className?: string;
}) {
  if (labels.length === 0) return null;
  return (
    <span className={`items-center gap-1 ${className ?? "flex shrink-0"}`}>
      {labels.slice(0, 3).map((label) => (
        <Badge
          key={label}
          variant="secondary"
          className="font-normal text-muted-foreground"
        >
          {label}
        </Badge>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Mutations (status, assignees, labels) with optimistic-friendly callbacks.
// ---------------------------------------------------------------------------

function useIssueMutations() {
  const rpc = useRpc<typeof githubRpcContract>();
  const setIssueState = useCallback(
    (repo: string, number: number, state: "open" | "closed") =>
      rpc
        .call("setIssueState", { repo, number, state })
        .then(() =>
          toast.success(
            state === "closed" ? `#${number} closed` : `#${number} reopened`,
          ),
        ),
    [rpc],
  );
  const setAssignees = useCallback(
    (repo: string, number: number, assignees: string[]) =>
      rpc.call("setAssignees", { repo, number, assignees }),
    [rpc],
  );
  const setLabels = useCallback(
    (repo: string, number: number, labels: string[]) =>
      rpc.call("setLabels", { repo, number, labels }),
    [rpc],
  );
  return { setIssueState, setAssignees, setLabels };
}

// ---------------------------------------------------------------------------
// Query engine — GitHub-style qualifiers parsed and matched client-side.
//   is:open · is:closed · is:merged · assignee:<login> · assignee:@me
//   author:<login> · label:<name> ("quoted" for spaces) · repo:<owner/name>
//   no:assignee · no:label · anything else matches title / number / repo
// ---------------------------------------------------------------------------

interface ParsedQuery {
  states: string[];
  assignees: string[];
  authors: string[];
  labels: string[];
  repos: string[];
  noAssignee: boolean;
  noLabel: boolean;
  text: string[];
}

function tokenizeQuery(query: string): string[] {
  return query.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
}

function unquote(value: string): string {
  return value.replace(/"/g, "");
}

const STATE_VALUES: Record<string, string> = {
  open: "OPEN",
  closed: "CLOSED",
  merged: "MERGED",
};

function parseQuery(query: string): ParsedQuery {
  const parsed: ParsedQuery = {
    states: [],
    assignees: [],
    authors: [],
    labels: [],
    repos: [],
    noAssignee: false,
    noLabel: false,
    text: [],
  };
  for (const token of tokenizeQuery(query)) {
    const idx = token.indexOf(":");
    const key = idx > 0 ? token.slice(0, idx).toLowerCase() : "";
    const value = idx > 0 ? unquote(token.slice(idx + 1)) : "";
    // A dangling "key:" (still being typed) filters nothing.
    if (idx > 0 && value.length === 0) continue;
    if (key === "is" || key === "state") {
      parsed.states.push(
        STATE_VALUES[value.toLowerCase()] ?? value.toUpperCase(),
      );
    } else if (key === "assignee") {
      parsed.assignees.push(value.toLowerCase());
    } else if (key === "author") {
      parsed.authors.push(value.toLowerCase());
    } else if (key === "label") {
      parsed.labels.push(value.toLowerCase());
    } else if (key === "repo") {
      parsed.repos.push(value.toLowerCase());
    } else if (key === "no") {
      if (value.toLowerCase() === "assignee") parsed.noAssignee = true;
      if (value.toLowerCase() === "label") parsed.noLabel = true;
    } else {
      parsed.text.push(unquote(token).toLowerCase());
    }
  }
  return parsed;
}

function matchesQuery(
  item: Item,
  query: ParsedQuery,
  viewer: string | null,
): boolean {
  if (query.states.length > 0 && !query.states.includes(item.state))
    return false;
  if (query.assignees.length > 0) {
    const wanted = query.assignees.map((login) =>
      login === "@me" ? (viewer?.toLowerCase() ?? "\u0000") : login,
    );
    if (!item.assignees.some((login) => wanted.includes(login.toLowerCase())))
      return false;
  }
  if (query.authors.length > 0) {
    const author = item.author.toLowerCase();
    const wanted = query.authors.map((login) =>
      login === "@me" ? (viewer?.toLowerCase() ?? "\u0000") : login,
    );
    if (!wanted.includes(author)) return false;
  }
  if (query.labels.length > 0) {
    const labels = item.labels.map((label) => label.toLowerCase());
    if (!query.labels.some((label) => labels.includes(label))) return false;
  }
  if (query.repos.length > 0 && !query.repos.includes(item.repo.toLowerCase()))
    return false;
  if (query.noAssignee && item.assignees.length > 0) return false;
  if (query.noLabel && item.labels.length > 0) return false;
  if (query.text.length > 0) {
    const haystack = `${item.title} #${item.number} ${item.repo}`.toLowerCase();
    if (!query.text.every((term) => haystack.includes(term))) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// The filter bar: one input, GitHub-style typeahead over keys and values.
// ---------------------------------------------------------------------------

interface Suggestion {
  /** Replaces the token being typed. */
  insert: string;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
}

const QUALIFIER_KEYS: Array<{ key: string; hint: string }> = [
  { key: "is:", hint: "state — open, closed, merged" },
  { key: "assignee:", hint: "assigned user, or @me" },
  { key: "author:", hint: "opened by" },
  { key: "label:", hint: "has label" },
  { key: "repo:", hint: "in repository" },
  { key: "no:", hint: "missing — assignee, label" },
];

function quoteValue(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}

function buildSuggestions(
  token: string,
  vocab: { users: string[]; labels: string[]; repos: RepoInfo[] },
  kind: "issue" | "pr",
  viewer: string | null,
): Suggestion[] {
  const idx = token.indexOf(":");
  if (idx <= 0) {
    const prefix = token.toLowerCase();
    return QUALIFIER_KEYS.filter((entry) => entry.key.startsWith(prefix)).map(
      (entry) => ({
        insert: entry.key,
        label: entry.key,
        hint: entry.hint,
      }),
    );
  }
  const key = token.slice(0, idx).toLowerCase();
  const partial = unquote(token.slice(idx + 1)).toLowerCase();
  const matches = (value: string) => value.toLowerCase().includes(partial);
  if (key === "is" || key === "state") {
    const states =
      kind === "pr" ? ["open", "closed", "merged"] : ["open", "closed"];
    return states.filter(matches).map((state) => ({
      insert: `${key}:${state} `,
      label: state,
      icon: <StateDot kind={kind} state={STATE_VALUES[state] ?? "OPEN"} />,
    }));
  }
  if (key === "assignee" || key === "author") {
    const users = ["@me", ...vocab.users];
    return users.filter(matches).map((login) => ({
      insert: `${key}:${login} `,
      label: login === "@me" && viewer !== null ? `@me (${viewer})` : login,
      icon:
        login === "@me" ? (
          viewer !== null ? (
            <Avatar login={viewer} size="size-4" />
          ) : undefined
        ) : (
          <Avatar login={login} size="size-4" />
        ),
    }));
  }
  if (key === "label") {
    return vocab.labels.filter(matches).map((label) => ({
      insert: `${key}:${quoteValue(label)} `,
      label,
    }));
  }
  if (key === "repo") {
    return vocab.repos
      .filter((repo) => matches(repo.repo))
      .map((repo) => ({
        insert: `${key}:${repo.repo} `,
        label: repo.repo,
        hint: repo.available ? undefined : "GitHub account unavailable",
      }));
  }
  if (key === "no") {
    return ["assignee", "label"].filter(matches).map((field) => ({
      insert: `${key}:${field} `,
      label: `no:${field}`,
    }));
  }
  return [];
}

function FilterBar({
  value,
  onChange,
  items,
  repos,
  kind,
}: {
  value: string;
  onChange: (value: string) => void;
  items: Item[] | null;
  repos: RepoInfo[];
  kind: "issue" | "pr";
}) {
  const viewer = useViewer();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [caret, setCaret] = useState(value.length);
  const [highlight, setHighlight] = useState(0);

  const vocab = useMemo(() => {
    const users = new Set<string>();
    const labels = new Set<string>();
    for (const item of items ?? []) {
      if (item.author.length > 0) users.add(item.author);
      for (const login of item.assignees) users.add(login);
      for (const label of item.labels) labels.add(label);
    }
    return {
      users: [...users].sort((a, b) => a.localeCompare(b)),
      labels: [...labels].sort((a, b) => a.localeCompare(b)),
      repos,
    };
  }, [items, repos]);

  // The token under the caret is what suggestions complete.
  const upToCaret = value.slice(0, caret);
  const tokenStart = upToCaret.lastIndexOf(" ") + 1;
  const token = upToCaret.slice(tokenStart);
  const suggestions = useMemo(
    () => buildSuggestions(token, vocab, kind, viewer).slice(0, 8),
    [token, vocab, kind, viewer],
  );
  const active = Math.min(highlight, Math.max(0, suggestions.length - 1));

  const syncCaret = () =>
    setCaret(inputRef.current?.selectionStart ?? value.length);

  const accept = (suggestion: Suggestion) => {
    const next =
      value.slice(0, tokenStart) + suggestion.insert + value.slice(caret);
    onChange(next);
    const position = tokenStart + suggestion.insert.length;
    setCaret(position);
    setHighlight(0);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(position, position);
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open || suggestions.length === 0) {
      if (event.key === "ArrowDown") setOpen(true);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((active + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((active - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      accept(suggestions[active]);
    }
  };

  return (
    <div className="relative">
      {/* Plain <input> (not the SDK Input): the typeahead needs a ref for
          caret positioning, which the SDK component doesn't forward. */}
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setHighlight(0);
          setCaret(event.target.selectionStart ?? event.target.value.length);
        }}
        onSelect={syncCaret}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        placeholder="Filter — is:open assignee:@me label:bug, or plain text"
        className="flex h-11 w-full rounded-md border border-input bg-transparent px-3 py-1 pr-11 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:h-9 sm:pr-8 sm:text-sm"
        spellCheck={false}
        autoComplete="off"
      />
      {value.length > 0 ? (
        <button
          className="absolute right-0 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:right-1 sm:size-8"
          onMouseDown={(event) => {
            event.preventDefault();
            onChange("");
            setCaret(0);
            inputRef.current?.focus();
          }}
          aria-label="Clear filter"
        >
          ✕
        </button>
      ) : null}
      {open && suggestions.length > 0 ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-md">
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion.insert}
              className={`flex min-h-11 w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                index === active
                  ? "bg-accent text-accent-foreground"
                  : "text-popover-foreground"
              }`}
              onMouseDown={(event) => {
                event.preventDefault();
                accept(suggestion);
              }}
              onMouseEnter={() => setHighlight(index)}
            >
              {suggestion.icon}
              <span className="min-w-0 truncate font-medium">
                {suggestion.label}
              </span>
              {suggestion.hint !== undefined ? (
                <span className="ml-auto shrink-0 pl-4 text-xs text-muted-foreground">
                  {suggestion.hint}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The list: a column-headed table.
// ---------------------------------------------------------------------------

// Shared column widths so the header row lines up with item rows. The table
// switches modes against its own width, not the browser viewport.
const COL = {
  id: "shrink-0 @[48rem]:w-12",
  assignee: "shrink-0 @[48rem]:w-20",
  status: "shrink-0 @[48rem]:w-24",
  updated: "hidden w-14 shrink-0 text-right @[48rem]:block",
  actions:
    "ml-auto flex shrink-0 items-center justify-end @[48rem]:ml-0 @[48rem]:w-10",
} as const;

function AssigneeCell({ assignees }: { assignees: string[] }) {
  if (assignees.length === 0) {
    return <span className="text-muted-foreground/50">—</span>;
  }
  return (
    <span
      className="flex items-center -space-x-1.5"
      title={assignees.join(", ")}
    >
      {assignees.slice(0, 3).map((login) => (
        <Avatar key={login} login={login} className="ring-1 ring-card" />
      ))}
      {assignees.length > 3 ? (
        <span className="pl-2.5 text-xs text-muted-foreground">
          +{assignees.length - 3}
        </span>
      ) : null}
    </span>
  );
}

/** Inline status control: a dropdown for issues, a static badge for PRs. */
function StatusCell({ item }: { item: Item }) {
  const { setIssueState } = useIssueMutations();
  const [pending, setPending] = useState(false);
  if (item.kind === "pr") {
    return <StateBadge kind="pr" state={item.state} />;
  }
  const change = (next: "open" | "closed") => {
    if ((item.state === "OPEN") === (next === "open")) return;
    setPending(true);
    setIssueState(item.repo, item.number, next)
      .catch((error: unknown) => toast.error(errorText(error)))
      .finally(() => setPending(false));
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={pending}>
        <Button
          size="sm"
          variant="ghost"
          className="h-11 gap-1.5 px-2 text-xs font-normal sm:h-7"
          onClick={(event) => event.stopPropagation()}
          aria-label={`Change issue #${item.number} state, currently ${item.state.toLowerCase()}`}
          aria-busy={pending}
        >
          <StateDot kind="issue" state={item.state} />
          <span>{pending ? "…" : item.state.toLowerCase()}</span>
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => change("open")}>
          <StateDot kind="issue" state="OPEN" />
          Open
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => change("closed")}>
          <StateDot kind="issue" state="CLOSED" />
          Closed
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RowMenu({ item }: { item: Item }) {
  const viewer = useViewer();
  const { setIssueState, setAssignees } = useIssueMutations();
  const assignedToMe = viewer !== null && item.assignees.includes(viewer);

  const toggleSelfAssign = () => {
    if (viewer === null) return;
    const next = assignedToMe
      ? item.assignees.filter((login) => login !== viewer)
      : [...item.assignees, viewer];
    setAssignees(item.repo, item.number, next)
      .then(() =>
        toast.success(
          assignedToMe
            ? `Unassigned from #${item.number}`
            : `Assigned to #${item.number}`,
        ),
      )
      .catch((error: unknown) => toast.error(errorText(error)));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="size-11 text-muted-foreground sm:size-7"
          onClick={(event) => event.stopPropagation()}
          aria-label={`More actions for ${item.kind === "issue" ? "issue" : "pull request"} #${item.number}`}
        >
          ⋮
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {item.kind === "issue" && viewer !== null ? (
          <DropdownMenuItem onSelect={toggleSelfAssign}>
            {assignedToMe ? "Unassign me" : "Assign to me"}
          </DropdownMenuItem>
        ) : null}
        {item.kind === "issue" ? (
          <DropdownMenuItem
            onSelect={() =>
              setIssueState(
                item.repo,
                item.number,
                item.state === "OPEN" ? "closed" : "open",
              ).catch((error: unknown) => toast.error(errorText(error)))
            }
          >
            {item.state === "OPEN" ? "Close issue" : "Reopen issue"}
          </DropdownMenuItem>
        ) : null}
        {item.kind === "issue" ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem onSelect={() => window.open(item.url, "_blank")}>
          Open on GitHub ↗
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            navigator.clipboard.writeText(item.url).then(
              () => toast.success("Link copied"),
              () => toast.error("Could not copy the link"),
            );
          }}
        >
          Copy link
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ItemRow({
  item,
  links,
  onOpen,
}: {
  item: Item;
  links: ThreadLink[] | undefined;
  onOpen: () => void;
}) {
  return (
    <div
      className="grid min-h-11 cursor-pointer grid-cols-1 gap-y-2 px-3 py-3 hover:bg-accent/50 @[48rem]:flex @[48rem]:items-center @[48rem]:gap-3 @[48rem]:py-2"
      onClick={onOpen}
    >
      <span className="flex min-w-0 flex-col items-start gap-1.5 @[48rem]:order-2 @[48rem]:flex-1 @[48rem]:flex-row @[48rem]:items-center @[48rem]:gap-2">
        <button
          type="button"
          className="min-w-0 flex-1 line-clamp-3 rounded text-left text-sm font-medium leading-snug text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring @[48rem]:line-clamp-1 @[48rem]:leading-normal"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          aria-label={`View ${item.kind === "issue" ? "issue" : "pull request"} #${item.number}: ${item.title}`}
        >
          {item.title}
        </button>
        <LabelChips
          labels={item.labels}
          className="hidden shrink-0 @[60rem]:flex"
        />
        <ThreadPills links={links} />
      </span>
      <span className="flex min-w-0 items-center gap-2 @[48rem]:contents">
        <span
          className={`${COL.id} font-mono text-xs text-muted-foreground @[48rem]:order-1`}
        >
          #{item.number}
        </span>
        <span
          className={`${COL.assignee} ${item.assignees.length === 0 ? "hidden @[48rem]:flex" : "flex"} text-xs text-muted-foreground @[48rem]:order-3`}
        >
          <AssigneeCell assignees={item.assignees} />
        </span>
        <span className={`${COL.status} @[48rem]:order-4`}>
          <StatusCell item={item} />
        </span>
        <span
          className={`${COL.updated} text-xs text-muted-foreground @[48rem]:order-5`}
        >
          {relativeTime(item.updatedAt)}
        </span>
        <span className={`${COL.actions} @[48rem]:order-6`}>
          <RowMenu item={item} />
        </span>
      </span>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="divide-y divide-border">
      {[0, 1, 2, 3].map((row) => (
        <div
          key={row}
          className="grid grid-cols-1 gap-y-3 px-3 py-3 @[48rem]:flex @[48rem]:items-center @[48rem]:gap-3"
        >
          <Skeleton className="h-3 w-4/5 @[48rem]:order-2 @[48rem]:flex-1" />
          <span className="flex items-center gap-2 @[48rem]:contents">
            <span className={`${COL.id} @[48rem]:order-1`}>
              <Skeleton className="h-3 w-10" />
            </span>
            <span className={`${COL.assignee} flex @[48rem]:order-3`}>
              <Skeleton className="size-5 rounded-full @[48rem]:h-3 @[48rem]:w-16" />
            </span>
            <span className={`${COL.status} @[48rem]:order-4`}>
              <Skeleton className="h-3 w-16" />
            </span>
            <span className={`${COL.updated} @[48rem]:order-5`}>
              <Skeleton className="ml-auto h-3 w-12" />
            </span>
            <span className={`${COL.actions} @[48rem]:order-6`}>
              <Skeleton className="h-7 w-20" />
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

function ItemsTable({
  kind,
  items,
  error,
  hasFilter,
  onOpenItem,
}: {
  kind: "issue" | "pr";
  items: Item[] | null;
  error: string | null;
  hasFilter: boolean;
  onOpenItem: (repo: string, number: number) => void;
}) {
  const links = useLinks();

  let body: React.ReactNode;
  if (error !== null && items === null) {
    body = <EmptyState message={error} />;
  } else if (items === null) {
    body = <TableSkeleton />;
  } else if (items.length === 0) {
    body = (
      <EmptyState
        message={
          hasFilter
            ? `No ${kind === "issue" ? "issues" : "pull requests"} match this filter.`
            : `No ${kind === "issue" ? "issues" : "pull requests"} in the tracked repos.`
        }
      />
    );
  } else {
    body = (
      <div className="divide-y divide-border">
        {items.map((item) => (
          <ItemRow
            key={`${item.repo}#${item.number}`}
            item={item}
            links={links[`${kind}:${item.repo}#${item.number}`]}
            onOpen={() => onOpenItem(item.repo, item.number)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="@container overflow-hidden rounded-lg border border-border bg-card">
      {error !== null && items !== null ? (
        <div
          role="status"
          className="border-b border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
        >
          Showing previously loaded results. {error}
        </div>
      ) : null}
      <div className="hidden items-center gap-3 border-b border-border bg-muted/50 px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground @[48rem]:flex">
        <span className={COL.id}>ID</span>
        <span className="min-w-0 flex-1">Title</span>
        <span className={COL.assignee}>Assignee</span>
        <span className={COL.status}>Status</span>
        <span className={COL.updated}>Updated</span>
        <span className={COL.actions} />
      </div>
      {body}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Issue detail: body + comments on the left, metadata sidebar on the right.
// ---------------------------------------------------------------------------

function SidebarHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </h3>
  );
}

function AssigneePicker({
  repo,
  assignees,
  onToggle,
  disabled = false,
}: {
  repo: string;
  assignees: string[];
  onToggle: (login: string, assigned: boolean) => void;
  disabled?: boolean;
}) {
  const rpc = useRpc<typeof githubRpcContract>();
  const viewer = useViewer();
  const [users, setUsers] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (users !== null) return;
    rpc.call("assignableUsers", { repo }).then(
      (result) => {
        const list = (result as { users?: unknown })?.users;
        setUsers(Array.isArray(list) ? list.map(String) : []);
      },
      (error: unknown) => setLoadError(errorText(error)),
    );
  }, [rpc, repo, users]);

  // The viewer floats to the top of the picker.
  const ordered =
    users === null
      ? null
      : [...users].sort((a, b) => Number(b === viewer) - Number(a === viewer));

  return (
    <DropdownMenu onOpenChange={(open) => open && load()}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs text-muted-foreground"
        >
          Edit
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-72 w-56 overflow-y-auto"
      >
        <DropdownMenuLabel>Assignees</DropdownMenuLabel>
        {loadError !== null ? (
          <DropdownMenuItem disabled>{loadError}</DropdownMenuItem>
        ) : ordered === null ? (
          <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
        ) : ordered.length === 0 ? (
          <DropdownMenuItem disabled>No assignable users</DropdownMenuItem>
        ) : (
          ordered.map((login) => (
            <DropdownMenuCheckboxItem
              key={login}
              checked={assignees.includes(login)}
              onCheckedChange={(checked) => onToggle(login, checked)}
              onSelect={(event) => event.preventDefault()}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Avatar login={login} size="size-4" />
                <span className="truncate">
                  {login}
                  {login === viewer ? " (you)" : ""}
                </span>
              </span>
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LabelPicker({
  repo,
  labels,
  onToggle,
  disabled = false,
}: {
  repo: string;
  labels: string[];
  onToggle: (label: string, enabled: boolean) => void;
  disabled?: boolean;
}) {
  const rpc = useRpc<typeof githubRpcContract>();
  const [available, setAvailable] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (available !== null) return;
    rpc.call("repositoryLabels", { repo }).then(
      (result) => {
        const list = (result as { labels?: unknown })?.labels;
        setAvailable(Array.isArray(list) ? list.map(String) : []);
      },
      (error: unknown) => setLoadError(errorText(error)),
    );
  }, [rpc, repo, available]);

  const ordered =
    available === null
      ? null
      : [...new Set([...labels, ...available])].sort((a, b) =>
          a.localeCompare(b),
        );

  return (
    <DropdownMenu onOpenChange={(open) => open && load()}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs text-muted-foreground"
        >
          Edit
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-72 w-56 overflow-y-auto"
      >
        <DropdownMenuLabel>Labels</DropdownMenuLabel>
        {loadError !== null ? (
          <DropdownMenuItem disabled>{loadError}</DropdownMenuItem>
        ) : ordered === null ? (
          <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
        ) : ordered.length === 0 ? (
          <DropdownMenuItem disabled>No labels in repo</DropdownMenuItem>
        ) : (
          ordered.map((label) => (
            <DropdownMenuCheckboxItem
              key={label}
              checked={labels.includes(label)}
              onCheckedChange={(checked) => onToggle(label, checked === true)}
              onSelect={(event) => event.preventDefault()}
            >
              <span className="min-w-0 truncate">{label}</span>
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function IssueDetailView({
  repo,
  number,
  onBack,
  repoInfo,
}: {
  repo: string;
  number: number;
  onBack: () => void;
  repoInfo: RepoInfo | undefined;
}) {
  const rpc = useRpc<typeof githubRpcContract>();
  const { login: viewer, phase: viewerPhase } = useViewerIdentity();
  const viewerVerified = viewerPhase === "verified";
  const links = useLinks();
  const { setIssueState, setAssignees, setLabels } = useIssueMutations();
  const [detail, setDetail] = useState<IssueDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);
  const available = repoInfo?.available === true;
  // Account-bound projects hydrate by their configured login. Unbound projects
  // hydrate only the payload tagged with the last verified CLI viewer; the next
  // successful viewer fetch switches this key before fresh data is stored.
  const cacheAccount =
    viewerPhase === "pending"
      ? null
      : (repoInfo?.githubAccountLogin ?? (available ? viewer : null));
  const writeAccount =
    repoInfo?.githubAccountLogin ?? (viewerVerified ? viewer : null);
  const cacheKey = `issue:${repo}#${number}`;

  const load = useCallback(() => {
    rpc.call("getIssue", { repo, number }).then(
      (result) => {
        const issue = (result as { issue?: IssueDetail })?.issue;
        if (issue === undefined) throw new Error("malformed getIssue result");
        setDetail(issue);
        writeCachedValue(cacheKey, writeAccount, issue);
        setError(null);
      },
      (err: unknown) => setError(errorText(err)),
    );
  }, [rpc, repo, number, cacheKey, writeAccount]);
  useEffect(() => {
    setDetail(readCachedValue(cacheKey, cacheAccount, issueDetailCacheSchema));
    load();
  }, [cacheKey, cacheAccount, load]);

  const changeState = useCallback(
    (next: "open" | "closed") => {
      if (!available) return;
      setDetail((prev) =>
        prev === null
          ? prev
          : { ...prev, state: next === "closed" ? "CLOSED" : "OPEN" },
      );
      setIssueState(repo, number, next).catch((err: unknown) => {
        toast.error(errorText(err));
        load();
      });
    },
    [available, setIssueState, repo, number, load],
  );

  const toggleAssignee = useCallback(
    (login: string, assigned: boolean) => {
      if (!available) return;
      let next: string[] = [];
      setDetail((prev) => {
        if (prev === null) return prev;
        next = assigned
          ? [...new Set([...prev.assignees, login])]
          : prev.assignees.filter((entry) => entry !== login);
        return { ...prev, assignees: next };
      });
      setAssignees(repo, number, next).catch((err: unknown) => {
        toast.error(errorText(err));
        load();
      });
    },
    [available, setAssignees, repo, number, load],
  );

  const toggleLabel = useCallback(
    (label: string, enabled: boolean) => {
      if (!available) return;
      let next: string[] = [];
      setDetail((prev) => {
        if (prev === null) return prev;
        next = enabled
          ? [...new Set([...prev.labels, label])]
          : prev.labels.filter((entry) => entry !== label);
        return { ...prev, labels: next };
      });
      setLabels(repo, number, next).catch((err: unknown) => {
        toast.error(errorText(err));
        load();
      });
    },
    [available, setLabels, repo, number, load],
  );

  const postComment = useCallback(() => {
    if (!available || comment.trim().length === 0) return;
    setPosting(true);
    rpc
      .call("commentIssue", { repo, number, body: comment })
      .then(() => {
        setComment("");
        load();
      })
      .catch((err: unknown) => toast.error(errorText(err)))
      .finally(() => setPosting(false));
  }, [available, rpc, repo, number, comment, load]);

  if (error !== null && detail === null) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-3 text-center">
        {repoInfo !== undefined ? (
          <RepositoryUnavailableNotice repo={repoInfo} />
        ) : null}
        <p className="max-w-md text-sm text-muted-foreground">
          {repoInfo?.available === false
            ? `Switch GitHub accounts to view live issue details. ${error}`
            : error}
        </p>
        <Button
          variant="outline"
          className="min-h-11 sm:min-h-9"
          onClick={load}
        >
          Try again
        </Button>
      </div>
    );
  }
  if (detail === null) {
    return (
      <div
        className="flex flex-col gap-4 px-3 sm:px-0"
        aria-label="Loading issue"
      >
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const issueLinks = links[`issue:${repo}#${number}`];
  return (
    <div className="flex min-h-full flex-col gap-4 px-3 sm:px-0">
      {repoInfo !== undefined ? (
        <RepositoryUnavailableNotice repo={repoInfo} />
      ) : null}
      {error !== null ? (
        <div
          role="status"
          className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
        >
          <span className="min-w-0 flex-1">
            Showing previously loaded details. {error}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11 shrink-0 sm:min-h-8"
            onClick={load}
          >
            Retry
          </Button>
        </div>
      ) : null}
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Button
          size="sm"
          variant="ghost"
          className="min-h-11 px-2 sm:min-h-7"
          onClick={onBack}
        >
          ← Issues
        </Button>
        <span>
          {repo} · #{number}
        </span>
        <span className="flex-1" />
        <a
          href={detail.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center underline hover:text-foreground sm:min-h-0"
        >
          Open on GitHub ↗
        </a>
      </div>

      <div className="flex items-start gap-3">
        <h2 className="min-w-0 flex-1 text-balance text-xl font-semibold leading-tight text-foreground sm:leading-snug">
          {detail.title}{" "}
          <span className="font-normal text-muted-foreground">
            #{detail.number}
          </span>
        </h2>
        <ConversationAction
          kind="issue"
          repo={repo}
          number={number}
          links={issueLinks}
          available={available}
          className="hidden sm:inline-flex sm:min-w-40"
        />
      </div>
      <MobileConversationBar
        kind="issue"
        repo={repo}
        number={number}
        links={issueLinks}
        available={available}
      />

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
              <Avatar login={detail.author} />
              <span className="font-medium text-foreground">
                {detail.author}
              </span>
              opened this issue · updated {relativeTime(detail.updatedAt)}
            </div>
            <div className="p-4">
              {detail.body.length > 0 ? (
                <Markdown content={detail.body} className="text-sm" />
              ) : (
                <p className="text-sm text-muted-foreground">
                  (no description)
                </p>
              )}
            </div>
          </div>

          {detail.comments.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold text-muted-foreground">
                Activity · {detail.comments.length}
              </h3>
              {detail.comments.map((entry, index) => (
                <div
                  key={index}
                  className="rounded-lg border border-border bg-card p-3"
                >
                  <p className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <Avatar login={entry.author} />
                    <span className="font-medium text-foreground">
                      {entry.author}
                    </span>{" "}
                    · {relativeTime(entry.createdAt)}
                  </p>
                  <Markdown content={entry.body} className="text-sm" />
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <Textarea
              disabled={!available}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Leave a comment…"
              rows={3}
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                className="min-h-11 sm:min-h-8"
                disabled={!available || posting || comment.trim().length === 0}
                onClick={postComment}
              >
                {posting ? "Posting…" : "Comment"}
              </Button>
            </div>
          </div>
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-5 lg:w-56">
          <div className="flex flex-col gap-2">
            <SidebarHeading>Status</SidebarHeading>
            <Select
              disabled={!available}
              value={detail.state === "OPEN" ? "open" : "closed"}
              onValueChange={(value) =>
                changeState(value === "closed" ? "closed" : "open")
              }
            >
              <SelectTrigger className="h-8 w-full text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">
                  <span className="flex items-center gap-2">
                    <StateDot kind="issue" state="OPEN" /> Open
                  </span>
                </SelectItem>
                <SelectItem value="closed">
                  <span className="flex items-center gap-2">
                    <StateDot kind="issue" state="CLOSED" /> Closed
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <SidebarHeading>Assignees</SidebarHeading>
              <AssigneePicker
                repo={repo}
                assignees={detail.assignees}
                onToggle={toggleAssignee}
                disabled={!available}
              />
            </div>
            {detail.assignees.length === 0 ? (
              <p className="text-sm text-muted-foreground">No one assigned</p>
            ) : (
              detail.assignees.map((login) => (
                <p
                  key={login}
                  className="flex items-center gap-2 text-sm text-foreground"
                >
                  <Avatar login={login} />
                  <span className="truncate">{login}</span>
                </p>
              ))
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <SidebarHeading>Labels</SidebarHeading>
              <LabelPicker
                repo={repo}
                labels={detail.labels}
                onToggle={toggleLabel}
                disabled={!available}
              />
            </div>
            {detail.labels.length === 0 ? (
              <p className="text-sm text-muted-foreground">None yet</p>
            ) : (
              <LabelChips labels={detail.labels} className="flex flex-wrap" />
            )}
          </div>

          {issueLinks !== undefined && issueLinks.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <SidebarHeading>Conversations</SidebarHeading>
              <ThreadPills links={issueLinks} />
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pull request detail — the VS Code-style PR view. One component serves both
// the nav panel (two-column with a metadata sidebar) and the thread side
// panel (compact single column via `compact`).
// ---------------------------------------------------------------------------

function pullStateBadgeParts(state: string): { dot: string; label: string } {
  if (state === "DRAFT")
    return { dot: "bg-muted-foreground/60", label: "draft" };
  if (state === "OPEN") return { dot: "bg-green-500", label: "open" };
  if (state === "MERGED") return { dot: "bg-purple-500", label: "merged" };
  return { dot: "bg-red-500", label: "closed" };
}

function PullStateBadge({ state }: { state: string }) {
  const { dot, label } = pullStateBadgeParts(state);
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span className={`size-2 shrink-0 rounded-full ${dot}`} />
      {label}
    </Badge>
  );
}

const REVIEW_STATE_LABELS: Record<string, string> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "requested changes",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
  PENDING: "review requested",
};

function reviewStateClass(state: string): string {
  if (state === "APPROVED") return "text-green-600 dark:text-green-400";
  if (state === "CHANGES_REQUESTED") return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}

function ReviewDecisionBadge({ decision }: { decision: string }) {
  if (decision === "APPROVED") {
    return (
      <Badge className="bg-green-600 text-white hover:bg-green-600">
        approved
      </Badge>
    );
  }
  if (decision === "CHANGES_REQUESTED") {
    return <Badge variant="destructive">changes requested</Badge>;
  }
  if (decision === "REVIEW_REQUIRED") {
    return <Badge variant="secondary">review required</Badge>;
  }
  return null;
}

function checkDotClass(status: PullCheck["status"]): string {
  if (status === "success") return "bg-green-500";
  if (status === "failure") return "bg-red-500";
  if (status === "pending")
    return "animate-pulse bg-yellow-500 motion-reduce:animate-none";
  return "bg-muted-foreground/50";
}

function ChecksSection({ checks }: { checks: PullCheck[] }) {
  const [open, setOpen] = useState(() =>
    checks.some((check) => check.status === "failure"),
  );
  if (checks.length === 0) return null;
  const passing = checks.filter((check) => check.status === "success").length;
  const failing = checks.filter((check) => check.status === "failure").length;
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <button
        className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <span
          className={`size-2 shrink-0 rounded-full ${
            failing > 0
              ? "bg-red-500"
              : passing === checks.length
                ? "bg-green-500"
                : "animate-pulse bg-yellow-500 motion-reduce:animate-none"
          }`}
        />
        <span className="font-medium text-foreground">Checks</span>
        <span className="text-xs text-muted-foreground">
          {passing}/{checks.length} passing
          {failing > 0 ? ` · ${failing} failing` : ""}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open ? (
        <div className="divide-y divide-border border-t border-border">
          {checks.map((check, index) => (
            <div
              key={`${check.name}-${index}`}
              className="flex items-center gap-2 px-3 py-1.5 text-xs"
            >
              <span
                className={`size-2 shrink-0 rounded-full ${checkDotClass(check.status)}`}
              />
              <span className="min-w-0 flex-1 truncate text-foreground">
                {check.name}
              </span>
              {check.url.length > 0 ? (
                <a
                  href={check.url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-muted-foreground underline hover:text-foreground"
                >
                  details ↗
                </a>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function readHostCodeTheme(): { dark: string; light: string } {
  const root = document.documentElement.dataset;
  return {
    dark: root.bbCodeThemeDark ?? "pierre-dark",
    light: root.bbCodeThemeLight ?? "pierre-light",
  };
}

/** Read lazily: this module also loads outside a DOM, such as in the plugin
    bundle tests, where a module-eval `document` access throws. */
let hostCodeTheme: { dark: string; light: string } | null = null;
const hostCodeThemeListeners = new Set<() => void>();
let hostCodeThemeObserver: MutationObserver | null = null;

function getHostCodeTheme(): { dark: string; light: string } {
  hostCodeTheme ??= readHostCodeTheme();
  return hostCodeTheme;
}

function subscribeHostCodeTheme(onStoreChange: () => void): () => void {
  hostCodeThemeListeners.add(onStoreChange);
  if (hostCodeThemeObserver === null) {
    hostCodeThemeObserver = new MutationObserver(() => {
      const next = readHostCodeTheme();
      const current = getHostCodeTheme();
      if (next.dark === current.dark && next.light === current.light) {
        return;
      }
      hostCodeTheme = next;
      for (const listener of hostCodeThemeListeners) listener();
    });
    hostCodeThemeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-bb-code-theme-dark", "data-bb-code-theme-light"],
    });
  }
  return () => {
    hostCodeThemeListeners.delete(onStoreChange);
  };
}

function useHostCodeTheme(): { dark: string; light: string } {
  return useSyncExternalStore(
    subscribeHostCodeTheme,
    getHostCodeTheme,
    getHostCodeTheme,
  );
}

/** The host toggles dark mode via a `dark` class on <html>; pierre's diff
    themes are picked per render, so track it live. */
function useIsDarkTheme(): boolean {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setDark(document.documentElement.classList.contains("dark")),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/**
 * A patch (or single `@@` hunk) rendered through the host's @pierre/diffs —
 * syntax highlighting included (the host provides the worker pool via
 * context). GitHub's REST patches lack the `diff --git` header, so one is
 * synthesized; unparseable input falls back to plain mono text.
 */
function DiffPatch({ path, patch }: { path: string; patch: string }) {
  const dark = useIsDarkTheme();
  const codeTheme = useHostCodeTheme();
  const fileDiff = useMemo<FileDiffMetadata | null>(() => {
    const normalized = patch.replace(/\r\n/g, "\n").trimEnd();
    if (normalized.length === 0) return null;
    const text = normalized.startsWith("diff --git")
      ? `${normalized}\n`
      : `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${normalized}\n`;
    try {
      return parsePatchFiles(text)[0]?.files[0] ?? null;
    } catch {
      return null;
    }
  }, [path, patch]);
  const options = useMemo(
    () =>
      ({
        diffStyle: "unified",
        overflow: "scroll",
        disableFileHeader: true,
        themeType: dark ? "dark" : "light",
        theme: codeTheme,
      }) as const,
    [codeTheme, dark],
  );
  if (fileDiff === null) {
    return (
      <pre className="overflow-x-auto px-3 py-2 font-mono text-xs leading-5 text-foreground/80">
        {patch}
      </pre>
    );
  }
  return <PierreFileDiff fileDiff={fileDiff} options={options} />;
}

function FileDiffCard({ file, url }: { file: PullFile; url: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <button
        className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <span className="shrink-0 text-xs text-muted-foreground">
          {open ? "▾" : "▸"}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
          {file.path}
        </span>
        {file.status !== "modified" ? (
          <Badge
            variant="secondary"
            className="shrink-0 font-normal text-muted-foreground"
          >
            {file.status}
          </Badge>
        ) : null}
        <span className="shrink-0 text-xs text-green-600 dark:text-green-400">
          +{file.additions}
        </span>
        <span className="shrink-0 text-xs text-red-600 dark:text-red-400">
          −{file.deletions}
        </span>
      </button>
      {open ? (
        file.patch !== null ? (
          <div className="border-t border-border">
            <DiffPatch path={file.path} patch={file.patch} />
          </div>
        ) : (
          <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
            Diff too large to inline —{" "}
            <a
              href={`${url}/files`}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              view on GitHub ↗
            </a>
          </p>
        )
      ) : null}
    </div>
  );
}

/** An inline review thread: file/line header, the tail of its diff hunk for
    context, then the comment chain. */
function ReviewThreadCard({ thread }: { thread: ReviewThread }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <p className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-1.5 font-mono text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{thread.path}</span>
        {thread.line !== null ? (
          <span className="shrink-0">:{thread.line}</span>
        ) : null}
      </p>
      {thread.diffHunk.length > 0 ? (
        <div className="border-b border-border">
          <DiffPatch path={thread.path} patch={thread.diffHunk} />
        </div>
      ) : null}
      <div className="flex flex-col gap-3 p-3">
        {thread.comments.map((entry, index) => (
          <div key={index}>
            <p className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
              <Avatar login={entry.author} size="size-4" />
              <span className="font-medium text-foreground">
                {entry.author}
              </span>{" "}
              · {relativeTime(entry.createdAt)}
            </p>
            <Markdown content={entry.body} className="text-sm" />
          </div>
        ))}
      </div>
    </div>
  );
}

type PullTimelineEntry =
  | { type: "comment"; author: string; body: string; createdAt: string }
  | {
      type: "review";
      author: string;
      state: string;
      body: string;
      createdAt: string;
    };

function PullTimeline({ activity }: { activity: PullActivity }) {
  const entries = useMemo<PullTimelineEntry[]>(() => {
    const merged: PullTimelineEntry[] = [
      ...activity.comments.map((comment) => ({
        type: "comment" as const,
        ...comment,
      })),
      // Body-less COMMENTED reviews are the containers of inline threads
      // (rendered separately below); showing them here would be noise.
      ...activity.reviews
        .filter(
          (review) => review.body.length > 0 || review.state !== "COMMENTED",
        )
        .map((review) => ({ type: "review" as const, ...review })),
    ];
    return merged.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [activity]);
  if (entries.length === 0 && activity.reviewThreads.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity yet</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-muted-foreground">
        Activity · {entries.length + activity.reviewThreads.length}
      </h3>
      {entries.map((entry, index) => (
        <div
          key={index}
          className="rounded-lg border border-border bg-card p-3"
        >
          <p className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
            <Avatar login={entry.author} />
            <span className="font-medium text-foreground">{entry.author}</span>
            {entry.type === "review" ? (
              <span className={`font-medium ${reviewStateClass(entry.state)}`}>
                {REVIEW_STATE_LABELS[entry.state] ?? entry.state.toLowerCase()}
              </span>
            ) : null}
            · {relativeTime(entry.createdAt)}
          </p>
          {entry.body.length > 0 ? (
            <Markdown content={entry.body} className="text-sm" />
          ) : null}
        </div>
      ))}
      {activity.reviewThreads.map((thread, index) => (
        <ReviewThreadCard key={index} thread={thread} />
      ))}
    </div>
  );
}

function PullReviewersList({
  pull,
  reviews,
}: {
  pull: PullSummary;
  reviews: PullReview[];
}) {
  const rows = useMemo(() => {
    const latest = new Map<string, { login: string; state: string }>();
    for (const review of reviews) {
      if (review.author.length > 0) {
        latest.set(review.author, {
          login: review.author,
          state: review.state,
        });
      }
    }
    for (const login of pull.reviewRequests) {
      latest.set(login, { login, state: "PENDING" });
    }
    return [...latest.values()];
  }, [pull.reviewRequests, reviews]);
  if (rows.length === 0)
    return <p className="text-sm text-muted-foreground">No reviewers</p>;
  return (
    <>
      {rows.map((row) => (
        <p
          key={row.login}
          className="flex items-center gap-2 text-sm text-foreground"
        >
          <Avatar login={row.login} />
          <span className="min-w-0 truncate">{row.login}</span>
          <span
            className={`ml-auto shrink-0 text-xs ${reviewStateClass(row.state)}`}
          >
            {REVIEW_STATE_LABELS[row.state] ?? row.state.toLowerCase()}
          </span>
        </p>
      ))}
    </>
  );
}

function PullCommentBox({
  repo,
  number,
  onPosted,
  disabled = false,
}: {
  repo: string;
  number: number;
  onPosted: () => void;
  disabled?: boolean;
}) {
  const rpc = useRpc<typeof githubRpcContract>();
  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);
  const post = useCallback(() => {
    if (disabled || comment.trim().length === 0) return;
    setPosting(true);
    rpc
      .call("commentPull", { repo, number, body: comment })
      .then(() => {
        setComment("");
        onPosted();
      })
      .catch((error: unknown) => toast.error(errorText(error)))
      .finally(() => setPosting(false));
  }, [disabled, rpc, repo, number, comment, onPosted]);
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        disabled={disabled}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder="Leave a comment…"
        rows={3}
      />
      <div className="flex justify-end">
        <Button
          size="sm"
          className="min-h-11 sm:min-h-8"
          disabled={disabled || posting || comment.trim().length === 0}
          onClick={post}
        >
          {posting ? "Posting…" : "Comment"}
        </Button>
      </div>
    </div>
  );
}

function PullDetailView({
  repo,
  number,
  onBack,
  backLabel = "Pull requests",
  compact = false,
  repoInfo,
}: {
  repo: string;
  number: number;
  onBack?: () => void;
  backLabel?: string;
  compact?: boolean;
  repoInfo?: RepoInfo;
}) {
  const rpc = useRpc<typeof githubRpcContract>();
  const { login: viewer, phase: viewerPhase } = useViewerIdentity();
  const viewerVerified = viewerPhase === "verified";
  const links = useLinks();
  const [pull, setPull] = useState<PullSummary | null>(null);
  const [activity, setActivity] = useState<PullActivity | null>(null);
  const [files, setFiles] = useState<PullFile[] | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const available = compact || repoInfo?.available === true;
  const cacheAccount =
    viewerPhase === "pending" ? null : (repoInfo?.githubAccountLogin ?? viewer);
  const writeAccount =
    repoInfo?.githubAccountLogin ?? (viewerVerified ? viewer : null);
  const pullCacheKey = `pull:${repo}#${number}`;
  const activityCacheKey = `pull-activity:${repo}#${number}`;
  const filesCacheKey = `pull-files:${repo}#${number}`;

  const load = useCallback(() => {
    rpc.call("getPull", { repo, number }).then(
      (result) => {
        const detail = (result as { pull?: PullSummary })?.pull;
        if (detail === undefined) throw new Error("malformed getPull result");
        setPull(detail);
        writeCachedValue(pullCacheKey, writeAccount, detail);
        setError(null);
      },
      (err: unknown) => setError(errorText(err)),
    );
  }, [rpc, repo, number, pullCacheKey, writeAccount]);
  const loadActivity = useCallback(() => {
    setActivityLoading(true);
    setActivityError(null);
    rpc
      .call("getPullActivity", { repo, number })
      .then(
        (result) => {
          const detail = (result as { activity?: PullActivity })?.activity;
          if (detail === undefined)
            throw new Error("malformed getPullActivity result");
          setActivity(detail);
          writeCachedValue(activityCacheKey, writeAccount, detail);
        },
        (err: unknown) => setActivityError(errorText(err)),
      )
      .finally(() => setActivityLoading(false));
  }, [rpc, repo, number, activityCacheKey, writeAccount]);
  const loadFiles = useCallback(() => {
    setFilesLoading(true);
    setFilesError(null);
    rpc
      .call("getPullFiles", { repo, number })
      .then(
        (result) => {
          const detail = (result as { files?: PullFile[] })?.files;
          if (detail === undefined)
            throw new Error("malformed getPullFiles result");
          setFiles(detail);
          writeCachedValue(filesCacheKey, writeAccount, detail);
        },
        (err: unknown) => setFilesError(errorText(err)),
      )
      .finally(() => setFilesLoading(false));
  }, [rpc, repo, number, filesCacheKey, writeAccount]);
  useEffect(() => {
    setPull(
      readCachedValue(pullCacheKey, cacheAccount, pullSummaryCacheSchema),
    );
    setActivity(
      readCachedValue(activityCacheKey, cacheAccount, pullActivityCacheSchema),
    );
    setFiles(
      readCachedValue(
        filesCacheKey,
        cacheAccount,
        z.array(pullFileCacheSchema),
      ),
    );
    setActivityError(null);
    setFilesError(null);
    load();
  }, [pullCacheKey, activityCacheKey, filesCacheKey, cacheAccount, load]);

  if (error !== null && pull === null) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-3 text-center">
        {repoInfo !== undefined ? (
          <RepositoryUnavailableNotice repo={repoInfo} />
        ) : null}
        <p className="max-w-md text-sm text-muted-foreground">
          {repoInfo?.available === false
            ? `Switch GitHub accounts to view live pull request details. ${error}`
            : error}
        </p>
        <Button
          variant="outline"
          className="min-h-11 sm:min-h-9"
          onClick={load}
        >
          Try again
        </Button>
      </div>
    );
  }
  if (pull === null) {
    return (
      <div
        className="flex flex-col gap-4 px-3 sm:px-0"
        aria-label="Loading pull request"
      >
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const pullLinks = links[`pr:${repo}#${number}`];
  const mainColumn = (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      <ChecksSection checks={pull.checks} />

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
          <Avatar login={pull.author} />
          <span className="font-medium text-foreground">{pull.author}</span>
          opened this pull request · updated {relativeTime(pull.updatedAt)}
        </div>
        <div className="p-4">
          {pull.body.length > 0 ? (
            <Markdown content={pull.body} className="text-sm" />
          ) : (
            <p className="text-sm text-muted-foreground">(no description)</p>
          )}
        </div>
      </div>

      {activity === null ? (
        <div className="flex flex-col gap-2">
          <Button
            size="sm"
            variant="outline"
            className="min-h-11 sm:min-h-8"
            disabled={activityLoading}
            onClick={loadActivity}
          >
            {activityLoading ? "Loading activity…" : "Load activity"}
          </Button>
          {activityError !== null ? (
            <p className="text-sm text-destructive">{activityError}</p>
          ) : null}
        </div>
      ) : (
        <PullTimeline activity={activity} />
      )}

      {pull.changedFiles === 0 ? null : files === null ? (
        <div className="flex flex-col gap-2">
          <Button
            size="sm"
            variant="outline"
            className="min-h-11 sm:min-h-8"
            disabled={filesLoading}
            onClick={loadFiles}
          >
            {filesLoading
              ? "Loading files…"
              : `Load ${pull.changedFiles} changed file${pull.changedFiles === 1 ? "" : "s"}`}
          </Button>
          {filesError !== null ? (
            <p className="text-sm text-destructive">{filesError}</p>
          ) : null}
        </div>
      ) : files.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-muted-foreground">
            Files changed · {files.length}
            <span className="ml-2 font-normal">
              <span className="text-green-600 dark:text-green-400">
                +{pull.additions}
              </span>{" "}
              <span className="text-red-600 dark:text-red-400">
                −{pull.deletions}
              </span>
            </span>
          </h3>
          {files.map((file) => (
            <FileDiffCard key={file.path} file={file} url={pull.url} />
          ))}
        </div>
      ) : null}

      <PullCommentBox
        repo={repo}
        number={number}
        disabled={!available}
        onPosted={() => {
          load();
          if (activity !== null) loadActivity();
        }}
      />
    </div>
  );

  return (
    <div className="flex min-h-full flex-col gap-4 px-3 sm:px-0">
      {repoInfo !== undefined ? (
        <RepositoryUnavailableNotice repo={repoInfo} />
      ) : null}
      {error !== null ? (
        <div
          role="status"
          className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
        >
          <span className="min-w-0 flex-1">
            Showing previously loaded details. {error}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11 shrink-0 sm:min-h-8"
            onClick={load}
          >
            Retry
          </Button>
        </div>
      ) : null}
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {onBack !== undefined ? (
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11 px-2 sm:min-h-7"
            onClick={onBack}
          >
            ← {backLabel}
          </Button>
        ) : null}
        <span className="min-w-0 truncate">
          {repo} · #{number}
        </span>
        <span className="flex-1" />
        <a
          href={pull.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 shrink-0 items-center underline hover:text-foreground sm:min-h-0"
        >
          Open on GitHub ↗
        </a>
      </div>

      <div className="flex items-start gap-3">
        <h2
          className={`min-w-0 flex-1 text-balance font-semibold leading-tight text-foreground sm:leading-snug ${compact ? "text-base" : "text-xl"}`}
        >
          {pull.title}{" "}
          <span className="font-normal text-muted-foreground">
            #{pull.number}
          </span>
        </h2>
        <ConversationAction
          kind="pr"
          repo={repo}
          number={number}
          links={pullLinks}
          available={available}
          className="hidden sm:inline-flex sm:min-w-40"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <PullStateBadge state={pull.state} />
        <ReviewDecisionBadge decision={pull.reviewDecision} />
        <span className="font-mono">
          {pull.baseRefName} ← {pull.headRefName}
        </span>
        <span>
          <span className="text-green-600 dark:text-green-400">
            +{pull.additions}
          </span>{" "}
          <span className="text-red-600 dark:text-red-400">
            −{pull.deletions}
          </span>{" "}
          · {pull.changedFiles} file
          {pull.changedFiles === 1 ? "" : "s"}
        </span>
        <LabelChips labels={pull.labels} className="flex flex-wrap" />
        <ThreadPills links={pullLinks} />
      </div>
      {!compact ? (
        <MobileConversationBar
          kind="pr"
          repo={repo}
          number={number}
          links={pullLinks}
          available={available}
        />
      ) : null}

      {compact ? (
        mainColumn
      ) : (
        <div className="flex flex-col gap-6 lg:flex-row">
          {mainColumn}
          <aside className="flex w-full shrink-0 flex-col gap-5 lg:w-56">
            <div className="flex flex-col gap-1">
              <SidebarHeading>Reviewers</SidebarHeading>
              <PullReviewersList
                pull={pull}
                reviews={activity?.reviews ?? []}
              />
            </div>
            <div className="flex flex-col gap-1">
              <SidebarHeading>Assignees</SidebarHeading>
              {pull.assignees.length === 0 ? (
                <p className="text-sm text-muted-foreground">No one assigned</p>
              ) : (
                pull.assignees.map((login) => (
                  <p
                    key={login}
                    className="flex items-center gap-2 text-sm text-foreground"
                  >
                    <Avatar login={login} />
                    <span className="truncate">{login}</span>
                  </p>
                ))
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <SidebarHeading>Labels</SidebarHeading>
              {pull.labels.length === 0 ? (
                <p className="text-sm text-muted-foreground">None yet</p>
              ) : (
                <LabelChips labels={pull.labels} className="flex flex-wrap" />
              )}
            </div>
            {pullLinks !== undefined && pullLinks.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <SidebarHeading>Conversations</SidebarHeading>
                <ThreadPills links={pullLinks} />
              </div>
            ) : null}
          </aside>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The thread side panel (threadPanelAction): auto-resolve the thread's own PR
// (its environment branch's PR, else the PR it was spawned to review) and
// show the compact PR view; fall back to a picker over cached open PRs.
// ---------------------------------------------------------------------------

function PullPickerList({
  onPick,
}: {
  onPick: (repo: string, number: number) => void;
}) {
  const { items, error } = useItems("pr");
  if (error !== null) return <EmptyState message={error} />;
  if (items === null) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-5/6" />
        <Skeleton className="h-5 w-2/3" />
      </div>
    );
  }
  const open = items.filter((item) => item.state === "OPEN");
  if (open.length === 0) {
    return <EmptyState message="No open pull requests in the tracked repos." />;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="divide-y divide-border">
        {open.map((item) => (
          <button
            key={`${item.repo}#${item.number}`}
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/50"
            onClick={() => onPick(item.repo, item.number)}
          >
            <StateDot kind="pr" state={item.state} />
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              #{item.number}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">
              {item.title}
            </span>
            <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
              {item.repo}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PullPanelTab({ threadId }: PluginThreadPanelProps) {
  useGithubStoreRealtime();
  const rpc = useRpc<typeof githubRpcContract>();
  const [resolved, setResolved] = useState(false);
  const [selected, setSelected] = useState<{
    repo: string;
    number: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    rpc.call("pullForThread", { threadId }).then(
      (result) => {
        if (cancelled) return;
        const pull = (
          result as { pull?: { repo?: unknown; number?: unknown } | null }
        )?.pull;
        if (
          pull &&
          typeof pull.repo === "string" &&
          typeof pull.number === "number"
        ) {
          setSelected({ repo: pull.repo, number: pull.number });
        }
        setResolved(true);
      },
      () => {
        if (!cancelled) setResolved(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, threadId]);

  if (!resolved) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (selected === null) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          No pull request is linked to this thread yet — pick one:
        </p>
        <PullPickerList
          onPick={(repo, number) => setSelected({ repo, number })}
        />
      </div>
    );
  }
  return (
    <PullDetailView
      repo={selected.repo}
      number={selected.number}
      compact
      backLabel="All PRs"
      onBack={() => setSelected(null)}
    />
  );
}

// ---------------------------------------------------------------------------
// New issue form.
// ---------------------------------------------------------------------------

function NewIssueForm({
  repos,
  onCreated,
  onCancel,
}: {
  repos: RepoInfo[];
  onCreated: (repo: string, number: number | null) => void;
  onCancel: () => void;
}) {
  const rpc = useRpc<typeof githubRpcContract>();
  const [repo, setRepo] = useState(
    () => repos.find((entry) => entry.available)?.repo ?? repos[0]?.repo ?? "",
  );
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [creating, setCreating] = useState(false);
  const selectedRepo = repos.find((entry) => entry.repo === repo);

  useEffect(() => {
    if (repos.length === 0) return;
    const availableRepo = repos.find((entry) => entry.available);
    if (repo.length === 0 || selectedRepo === undefined) {
      setRepo(availableRepo?.repo ?? repos[0]?.repo ?? "");
    } else if (!selectedRepo.available && availableRepo !== undefined) {
      setRepo(availableRepo.repo);
    }
  }, [repo, repos, selectedRepo]);

  const create = useCallback(() => {
    if (selectedRepo?.available !== true) return;
    setCreating(true);
    rpc
      .call("createIssue", { repo, title, body })
      .then((result) => {
        const number = (result as { number?: unknown })?.number;
        toast.success("Issue created");
        onCreated(repo, typeof number === "number" ? number : null);
      })
      .catch((err: unknown) => toast.error(errorText(err)))
      .finally(() => setCreating(false));
  }, [selectedRepo?.available, rpc, repo, title, body, onCreated]);

  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <h2 className="text-lg font-semibold text-foreground">New issue</h2>
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="github-new-issue-repository"
          className="text-sm font-medium text-foreground"
        >
          Repository
        </label>
        <Select value={repo} onValueChange={setRepo}>
          <SelectTrigger
            id="github-new-issue-repository"
            className="min-h-11 w-full sm:min-h-9"
          >
            <SelectValue placeholder="Repository" />
          </SelectTrigger>
          <SelectContent>
            {repos.map((entry) => (
              <SelectItem
                key={`${entry.projectId}:${entry.repo}`}
                value={entry.repo}
                disabled={!entry.available}
              >
                {entry.repo}
                {entry.available ? "" : " — unavailable"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedRepo !== undefined && !selectedRepo.available ? (
          <p className="text-sm text-muted-foreground">
            {accountSwitchGuidance(selectedRepo)}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="github-new-issue-title"
          className="text-sm font-medium text-foreground"
        >
          Title
        </label>
        <Input
          id="github-new-issue-title"
          className="min-h-11 sm:min-h-9"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Summarize the issue"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="github-new-issue-description"
          className="text-sm font-medium text-foreground"
        >
          Description
        </label>
        <Textarea
          id="github-new-issue-description"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Add context, expected behavior, or reproduction steps (Markdown supported)"
          rows={8}
        />
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          className="min-h-11 sm:min-h-8"
          disabled={
            selectedRepo?.available !== true ||
            creating ||
            title.trim().length === 0 ||
            repo.length === 0
          }
          onClick={create}
        >
          {creating ? "Creating…" : "Create issue"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="min-h-11 sm:min-h-8"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The panel: tab bar + filters + routed body.
// ---------------------------------------------------------------------------

interface Status {
  ghOk: boolean;
  ghError: string | null;
  repos: RepoInfo[];
  lastSyncedAt: string | null;
}

let statusSnapshot: Status | null = readCachedValue(
  "status",
  "metadata",
  statusCacheSchema,
);
let statusInitialized = false;
let statusInFlight = false;
const statusListeners = new Set<() => void>();

function updateStatusSnapshot(next: Status): void {
  statusSnapshot = next;
  writeCachedValue("status", "metadata", next);
  for (const listener of statusListeners) listener();
}

function refreshStatus(
  fetchStatus: () => Promise<unknown>,
  force = false,
): void {
  if (statusInFlight || (statusInitialized && !force)) return;
  statusInitialized = true;
  statusInFlight = true;
  fetchStatus()
    .then(
      (result) => {
        const parsed = statusCacheSchema.safeParse(result);
        if (parsed.success) updateStatusSnapshot(parsed.data);
      },
      () => {},
    )
    .finally(() => {
      statusInFlight = false;
    });
}

function useStatus(): { status: Status | null; refetch: () => void } {
  const rpc = useRpc<typeof githubRpcContract>();
  const refetch = useCallback(() => {
    refreshStatus(() => rpc.call("status"), true);
  }, [rpc]);
  useEffect(() => {
    refreshStatus(() => rpc.call("status"));
  }, [rpc]);
  const status = useSyncExternalStore(
    (listener) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    () => statusSnapshot,
    () => statusSnapshot,
  );
  return { status, refetch };
}

function useGithubStoreRealtime(): void {
  const rpc = useRpc<typeof githubRpcContract>();
  const refreshIdentityAndStatus = useCallback(() => {
    refreshViewer(() => rpc.call("viewer"), true);
    refreshStatus(() => rpc.call("status"), true);
  }, [rpc]);
  const refreshStatusOnly = useCallback(() => {
    refreshStatus(() => rpc.call("status"), true);
  }, [rpc]);
  useRealtime("sync-changed", refreshIdentityAndStatus);
  useRealtime("data-changed", refreshStatusOnly);
}

function PanelHeader() {
  const rpc = useRpc<typeof githubRpcContract>();
  const { status } = useStatus();
  const [syncing, setSyncing] = useState(false);
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(() => {
    setSyncing(true);
    setFailed(false);
    rpc
      .call("refresh")
      .catch(() => setFailed(true))
      .finally(() => setSyncing(false));
  }, [rpc]);
  return (
    <>
      <span className="hidden text-xs text-muted-foreground sm:inline">
        {failed
          ? "Sync failed — check `gh auth status`"
          : status === null
            ? "Loading…"
            : status.ghOk
              ? `${status.repos.length} repo${status.repos.length === 1 ? "" : "s"} · synced ${
                  status.lastSyncedAt !== null
                    ? relativeTime(status.lastSyncedAt)
                    : "never"
                }`
              : "GitHub CLI not authenticated"}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="size-8 gap-1.5 px-0 sm:h-8 sm:w-auto sm:px-3"
        disabled={syncing}
        onClick={refresh}
        aria-label={syncing ? "Syncing GitHub data" : "Refresh GitHub data"}
      >
        <RefreshIcon
          className={
            syncing ? "animate-spin motion-reduce:animate-none" : undefined
          }
        />
        <span className="hidden sm:inline">
          {syncing ? "Syncing…" : "Refresh"}
        </span>
      </Button>
    </>
  );
}

const QUERY_KEY = "bb-plugin-github:query";
const DEFAULT_QUERY = "is:open ";

function GithubPanel({ subPath }: PluginNavPanelProps) {
  useGithubStoreRealtime();
  const [route, navigate] = useSubPathRoute(subPath);
  const { status } = useStatus();
  const [query, setQueryState] = useState<string>(() => {
    try {
      return window.localStorage.getItem(QUERY_KEY) ?? DEFAULT_QUERY;
    } catch {
      return DEFAULT_QUERY;
    }
  });
  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    try {
      window.localStorage.setItem(QUERY_KEY, next);
    } catch {
      // private mode / storage disabled — the filter just won't persist
    }
  }, []);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-3 sm:p-4 md:p-5">
      <PageBody className="min-h-full max-w-5xl">
        <GithubPanelBody
          route={route}
          navigate={navigate}
          status={status}
          query={query}
          setQuery={setQuery}
        />
      </PageBody>
    </div>
  );
}

function ListView({
  kind,
  query,
  setQuery,
  repos,
  onOpenItem,
}: {
  kind: "issue" | "pr";
  query: string;
  setQuery: (query: string) => void;
  repos: RepoInfo[];
  onOpenItem: (repo: string, number: number) => void;
}) {
  const { items, error } = useItems(kind);
  const viewer = useViewer();
  const parsed = useMemo(() => parseQuery(query), [query]);
  const filtered = useMemo(
    () =>
      items === null
        ? null
        : items.filter((item) => matchesQuery(item, parsed, viewer)),
    [items, parsed, viewer],
  );
  const unavailableRepos = repos.filter((repo) => !repo.available);
  return (
    <>
      <FilterBar
        value={query}
        onChange={setQuery}
        items={items}
        repos={repos}
        kind={kind}
      />
      {unavailableRepos.length > 0 ? (
        <details className="overflow-hidden rounded-lg border border-border bg-muted/40 text-xs text-muted-foreground">
          <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 py-2 font-medium text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring">
            {unavailableRepos.length === 1
              ? "1 repository needs a different GitHub account"
              : `${unavailableRepos.length} repositories need a different GitHub account`}
            <span className="ml-auto font-normal text-muted-foreground">
              Details
            </span>
          </summary>
          <div className="space-y-1 border-t border-border px-3 py-2">
            {unavailableRepos.map((repo) => (
              <p key={`${repo.projectId}:${repo.repo}`}>
                <span className="font-medium text-foreground">{repo.repo}</span>{" "}
                — {accountSwitchGuidance(repo)}
              </p>
            ))}
          </div>
        </details>
      ) : null}
      <ItemsTable
        kind={kind}
        items={filtered}
        error={error}
        hasFilter={query.trim().length > 0}
        onOpenItem={onOpenItem}
      />
    </>
  );
}

function GithubPanelBody({
  route,
  navigate,
  status,
  query,
  setQuery,
}: {
  route: Route;
  navigate: (route: Route) => void;
  status: Status | null;
  query: string;
  setQuery: (query: string) => void;
}) {
  if (status !== null && !status.ghOk) {
    return (
      <div className="px-3 sm:px-0">
        <EmptyState
          message={`GitHub CLI is not available or not authenticated. Install it from cli.github.com, run \`gh auth login\`, then reload the plugin. (${status.ghError ?? ""})`}
        />
      </div>
    );
  }
  if (status !== null && status.repos.length === 0) {
    return (
      <div className="px-3 sm:px-0">
        <EmptyState message="No GitHub repositories are available yet. Add a repository to BB to see its issues and pull requests here." />
      </div>
    );
  }

  if (route.view === "issue") {
    return (
      <IssueDetailView
        repo={route.repo}
        number={route.number}
        repoInfo={status?.repos.find((entry) => entry.repo === route.repo)}
        onBack={() => navigate({ view: "issues" })}
      />
    );
  }
  if (route.view === "pull") {
    return (
      <PullDetailView
        repo={route.repo}
        number={route.number}
        repoInfo={status?.repos.find((entry) => entry.repo === route.repo)}
        onBack={() => navigate({ view: "pulls" })}
      />
    );
  }
  if (route.view === "new") {
    return (
      <div className="px-3 sm:px-0">
        <NewIssueForm
          repos={status?.repos ?? []}
          onCreated={(repo, number) =>
            navigate(
              number !== null
                ? { view: "issue", repo, number }
                : { view: "issues" },
            )
          }
          onCancel={() => navigate({ view: "issues" })}
        />
      </div>
    );
  }

  const kind = route.view === "pulls" ? "pr" : "issue";
  return (
    <div className="flex flex-col gap-3 px-3 sm:px-0">
      <div className="flex items-center gap-2">
        <Tabs
          value={route.view}
          onValueChange={(value) => {
            navigate(
              value === "pulls" ? { view: "pulls" } : { view: "issues" },
            );
          }}
        >
          <TabsList className="h-11 sm:h-9">
            <TabsTrigger className="min-h-9 sm:min-h-7" value="issues">
              Issues
            </TabsTrigger>
            <TabsTrigger className="min-h-9 sm:min-h-7" value="pulls">
              Pull requests
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex-1" />
        {route.view === "issues" ? (
          <Button
            size="sm"
            className="min-h-11 sm:min-h-8"
            onClick={() => navigate({ view: "new" })}
          >
            New issue
          </Button>
        ) : null}
      </div>

      <ListView
        kind={kind}
        query={query}
        setQuery={setQuery}
        repos={status?.repos ?? []}
        onOpenItem={(repo, number) =>
          navigate(
            kind === "pr"
              ? { view: "pull", repo, number }
              : { view: "issue", repo, number },
          )
        }
      />
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "github",
    title: "GitHub",
    icon: "Github",
    path: "github",
    component: GithubPanel,
    headerContent: PanelHeader,
  });
  app.slots.threadPanelAction({
    id: "pull",
    title: "GitHub PR",
    icon: "Github",
    component: PullPanelTab,
  });
});
