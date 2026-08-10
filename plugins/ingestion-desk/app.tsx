import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { FormEvent } from "react";
import {
  definePluginApp,
  useRealtime,
  useRpc,
  type PluginNavPanelProps,
} from "@bb/plugin-sdk/app";
import type { ingestionRpcContract } from "./server.js";
import "./app.css";

const CASE_STATUSES = [
  "inbox",
  "needs_context",
  "drafting",
  "ready",
  "publishing",
  "published",
  "sync_blocked",
] as const;
const SOURCE_KINDS = [
  "upload",
  "pasted",
  "drive_link",
  "granola_paste",
  "url",
] as const;

type CaseStatus = (typeof CASE_STATUSES)[number];
type SourceKind = (typeof SOURCE_KINDS)[number];

interface Source {
  id: string;
  label: string;
  kind: SourceKind;
  authority: "primary" | "context" | "evidence";
  url: string | null;
  content: string | null;
  description: string;
}

interface Detail {
  date: string | null;
  project: string | null;
  attendees: string[];
  meetingType: string | null;
}

interface Provenance {
  id: string;
  kind: "source" | "draft" | "review" | "publish";
  message: string;
  sourceId: string | null;
}

interface Output {
  path: string;
  summary: string;
}

interface IngestionCase {
  id: string;
  title: string;
  status: CaseStatus;
  summary: string;
  projectId: string;
  sources: Source[];
  details: Detail;
  provenance: Provenance[];
  outputs: Output[];
  git: GitParity;
}

interface Project {
  id: string;
  name: string;
}

interface GitParity {
  state: "not_checked" | "ready" | "published" | "blocked" | "unavailable";
  localHead: string | null;
  remoteHead: string | null;
  publishedCommit: string | null;
  message: string | null;
}

interface Bootstrap {
  cases: IngestionCase[];
  projects: Project[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCaseStatus(value: unknown): value is CaseStatus {
  return (
    typeof value === "string" && CASE_STATUSES.includes(value as CaseStatus)
  );
}

function isSourceKind(value: unknown): value is SourceKind {
  return (
    typeof value === "string" && SOURCE_KINDS.includes(value as SourceKind)
  );
}

function parseSource(value: unknown): Source {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.label !== "string" ||
    !isSourceKind(value.kind) ||
    (value.authority !== "primary" &&
      value.authority !== "context" &&
      value.authority !== "evidence") ||
    (value.url !== null && typeof value.url !== "string") ||
    (value.content !== null && typeof value.content !== "string") ||
    typeof value.description !== "string"
  ) {
    throw new Error("Ingestion Desk returned an invalid source.");
  }
  return {
    id: value.id,
    label: value.label,
    kind: value.kind,
    authority: value.authority,
    url: value.url,
    content: value.content,
    description: value.description,
  };
}

function parseCase(value: unknown): IngestionCase {
  if (!isRecord(value) || !isCaseStatus(value.status)) {
    throw new Error("Ingestion Desk returned an invalid case.");
  }
  if (
    typeof value.id !== "string" ||
    typeof value.projectId !== "string" ||
    typeof value.title !== "string" ||
    typeof value.summary !== "string" ||
    !Array.isArray(value.sources) ||
    !isRecord(value.details) ||
    (value.details.date !== null && typeof value.details.date !== "string") ||
    (value.details.project !== null &&
      typeof value.details.project !== "string") ||
    !Array.isArray(value.details.attendees) ||
    !value.details.attendees.every(
      (attendee) => typeof attendee === "string",
    ) ||
    (value.details.meetingType !== null &&
      typeof value.details.meetingType !== "string") ||
    !Array.isArray(value.provenance) ||
    !Array.isArray(value.outputs) ||
    !isRecord(value.git)
  ) {
    throw new Error("Ingestion Desk returned an invalid case.");
  }
  const provenance = value.provenance.map((item): Provenance => {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      (item.kind !== "source" &&
        item.kind !== "draft" &&
        item.kind !== "review" &&
        item.kind !== "publish") ||
      typeof item.message !== "string" ||
      (item.sourceId !== null && typeof item.sourceId !== "string")
    ) {
      throw new Error("Ingestion Desk returned invalid provenance.");
    }
    return {
      id: item.id,
      kind: item.kind,
      message: item.message,
      sourceId: item.sourceId,
    };
  });
  const outputs = value.outputs.map((item): Output => {
    if (
      !isRecord(item) ||
      typeof item.path !== "string" ||
      typeof item.summary !== "string"
    ) {
      throw new Error("Ingestion Desk returned invalid outputs.");
    }
    return { path: item.path, summary: item.summary };
  });
  return {
    id: value.id,
    projectId: value.projectId,
    title: value.title,
    status: value.status,
    summary: value.summary,
    sources: value.sources.map(parseSource),
    details: {
      date: value.details.date,
      project: value.details.project,
      attendees: value.details.attendees,
      meetingType: value.details.meetingType,
    },
    provenance,
    outputs,
    git: parseGit(value.git),
  };
}

function parseGit(value: unknown): GitParity {
  if (
    !isRecord(value) ||
    (value.state !== "not_checked" &&
      value.state !== "ready" &&
      value.state !== "published" &&
      value.state !== "blocked" &&
      value.state !== "unavailable") ||
    (value.localHead !== null && typeof value.localHead !== "string") ||
    (value.remoteHead !== null && typeof value.remoteHead !== "string") ||
    (value.publishedCommit !== null &&
      typeof value.publishedCommit !== "string") ||
    (value.message !== null && typeof value.message !== "string")
  ) {
    throw new Error("Ingestion Desk returned an invalid Git status.");
  }
  return {
    state: value.state,
    localHead: value.localHead,
    remoteHead: value.remoteHead,
    publishedCommit: value.publishedCommit,
    message: value.message,
  };
}

function parseBootstrap(value: unknown): Bootstrap {
  if (
    !isRecord(value) ||
    !Array.isArray(value.cases) ||
    !Array.isArray(value.projects)
  ) {
    throw new Error("Ingestion Desk returned an invalid workspace.");
  }
  return {
    cases: value.cases.map(parseCase),
    projects: value.projects.map((project): Project => {
      if (
        !isRecord(project) ||
        typeof project.id !== "string" ||
        typeof project.name !== "string"
      ) {
        throw new Error("Ingestion Desk returned an invalid project.");
      }
      return { id: project.id, name: project.name };
    }),
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function statusLabel(status: CaseStatus): string {
  return {
    inbox: "Inbox",
    needs_context: "Needs context",
    drafting: "Drafting",
    ready: "Ready for review",
    publishing: "Publishing",
    published: "Published",
    sync_blocked: "Sync blocked",
  }[status];
}

function sourceKindLabel(kind: SourceKind): string {
  return {
    drive_link: "Google Drive",
    granola_paste: "Granola",
    pasted: "Pasted text",
    upload: "Upload",
    url: "Web link",
  }[kind];
}

function tabsMove(
  bar: HTMLDivElement | null,
  active: string,
  animate: boolean,
): void {
  if (bar === null) return;
  const pill = bar.querySelector<HTMLElement>(".t-tabs-pill");
  const tab = bar.querySelector<HTMLElement>(`[data-view="${active}"]`);
  if (pill === null || tab === null) return;
  if (!animate) {
    const previousTransition = pill.style.transition;
    pill.style.transition = "none";
    pill.style.transform = `translateX(${tab.offsetLeft}px)`;
    pill.style.width = `${tab.offsetWidth}px`;
    void pill.offsetWidth;
    pill.style.transition = previousTransition;
    return;
  }
  pill.style.transform = `translateX(${tab.offsetLeft}px)`;
  pill.style.width = `${tab.offsetWidth}px`;
}

function AddCaseForm({
  projects,
  onCreate,
  pending,
}: {
  projects: Project[];
  onCreate: (input: {
    title: string;
    sourceKind: SourceKind;
    label: string;
    content: string;
    projectId: string;
  }) => void;
  pending: boolean;
}) {
  const [title, setTitle] = useState("");
  const [sourceKind, setSourceKind] = useState<SourceKind>("drive_link");
  const [label, setLabel] = useState("");
  const [content, setContent] = useState("");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const isLink = sourceKind === "drive_link";

  return (
    <form
      className="ingestion-add-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim() || !label.trim() || !content.trim() || !projectId)
          return;
        onCreate({
          title: title.trim(),
          sourceKind,
          label: label.trim(),
          content: content.trim(),
          projectId,
        });
      }}
    >
      <label>
        Case title
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="SKU coverage review"
          required
        />
      </label>
      <div className="ingestion-add-grid">
        <label>
          Source type
          <select
            value={sourceKind}
            onChange={(event) =>
              setSourceKind(event.target.value as SourceKind)
            }
          >
            <option value="drive_link">Google Drive link</option>
            <option value="granola_paste">Granola notes</option>
            <option value="pasted">Pasted text</option>
          </select>
        </label>
        <label>
          Project
          <select
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Source label
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Meet transcript, notes, or document name"
          required
        />
      </label>
      <label>
        {isLink ? "Google Drive or Meet link" : "Notes or transcript"}
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder={
            isLink
              ? "https://drive.google.com/..."
              : "Paste the meeting notes or transcript"
          }
          required
        />
      </label>
      <button
        className="ingestion-button ingestion-button-primary"
        type="submit"
        disabled={pending}
      >
        {pending ? "Adding…" : "Add to inbox"}
      </button>
    </form>
  );
}

function AddSourceForm({
  caseId,
  pending,
  onAdd,
}: {
  caseId: string;
  pending: boolean;
  onAdd: (input: {
    sourceKind: SourceKind;
    label: string;
    content: string;
  }) => void;
}) {
  const [sourceKind, setSourceKind] = useState<SourceKind>("drive_link");
  const [label, setLabel] = useState("");
  const [content, setContent] = useState("");
  const isLink = sourceKind === "drive_link" || sourceKind === "url";
  return (
    <form
      className="ingestion-source-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (label.trim() && content.trim())
          onAdd({ sourceKind, label: label.trim(), content: content.trim() });
      }}
    >
      <label>
        Source type
        <select
          aria-label="Additional source type"
          value={sourceKind}
          onChange={(event) => setSourceKind(event.target.value as SourceKind)}
        >
          <option value="drive_link">Google Drive link</option>
          <option value="granola_paste">Granola notes</option>
          <option value="pasted">Pasted text</option>
        </select>
      </label>
      <label>
        Source label
        <input
          aria-label="Additional source label"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          required
        />
      </label>
      <label>
        {isLink ? "Google Drive or Meet link" : "Notes or transcript"}
        <textarea
          aria-label="Additional source content"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          required
        />
      </label>
      <button
        className="ingestion-button ingestion-button-secondary"
        type="submit"
        disabled={pending}
      >
        Add source
      </button>
    </form>
  );
}

function IngestionDesk(_props: PluginNavPanelProps) {
  const rpc = useRpc<typeof ingestionRpcContract>();
  const [workspace, setWorkspace] = useState<Bootstrap | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState("sources");
  const [showAddForm, setShowAddForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const tabsRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = parseBootstrap(
        await rpc.call("bootstrap", { projectId: null }),
      );
      setWorkspace(next);
      setSelectedId((current) =>
        current && next.cases.some((item) => item.id === current)
          ? current
          : (next.cases[0]?.id ?? null),
      );
    } catch (loadError: unknown) {
      setError(errorText(loadError));
    } finally {
      setLoading(false);
    }
  }, [rpc]);

  useEffect(() => {
    void load();
  }, [load]);
  useRealtime("ingestion:changed", () => {
    void load();
  });
  useLayoutEffect(() => {
    tabsMove(tabsRef.current, activeView, false);
  }, [activeView]);
  useEffect(() => {
    const resize = () => tabsMove(tabsRef.current, activeView, false);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [activeView]);
  useEffect(() => {
    setDetailVisible(false);
    const frame = requestAnimationFrame(() => setDetailVisible(true));
    return () => cancelAnimationFrame(frame);
  }, [selectedId]);

  const selected =
    workspace?.cases.find((item) => item.id === selectedId) ?? null;
  const selectCase = (id: string) => {
    setSelectedId(id);
    setActiveView("sources");
  };
  const runAction = async (
    method: "startDraft" | "publishCase" | "refreshCase",
    id: string,
    preserveLocalChanges = false,
  ) => {
    setWorking(true);
    setError(null);
    try {
      if (method === "publishCase") {
        await rpc.call(method, { caseId: id, preserveLocalChanges });
      } else {
        await rpc.call(method, { caseId: id });
      }
      await load();
    } catch (actionError: unknown) {
      setError(errorText(actionError));
    } finally {
      setWorking(false);
    }
  };
  const createCase = async (
    input: Parameters<typeof AddCaseForm>[0]["onCreate"] extends (
      input: infer T,
    ) => void
      ? T
      : never,
  ) => {
    setWorking(true);
    setError(null);
    try {
      await rpc.call("createCase", {
        projectId: input.projectId,
        title: input.title,
        source: {
          kind: input.sourceKind,
          label: input.label,
          authority: "primary",
          url:
            input.sourceKind === "drive_link" || input.sourceKind === "url"
              ? input.content
              : null,
          content:
            input.sourceKind === "drive_link" || input.sourceKind === "url"
              ? null
              : input.content,
        },
      });
      setShowAddForm(false);
      await load();
    } catch (createError: unknown) {
      setError(errorText(createError));
    } finally {
      setWorking(false);
    }
  };
  const updateDetails = async (id: string, details: Detail) => {
    setWorking(true);
    setError(null);
    try {
      await rpc.call("updateCase", { caseId: id, details, status: "inbox" });
      await load();
    } catch (updateError: unknown) {
      setError(errorText(updateError));
    } finally {
      setWorking(false);
    }
  };
  const addSource = async (
    caseId: string,
    input: { sourceKind: SourceKind; label: string; content: string },
  ) => {
    setWorking(true);
    setError(null);
    try {
      await rpc.call("addSource", {
        caseId,
        source: {
          kind: input.sourceKind,
          label: input.label,
          authority: "context",
          url:
            input.sourceKind === "drive_link" || input.sourceKind === "url"
              ? input.content
              : null,
          content:
            input.sourceKind === "drive_link" || input.sourceKind === "url"
              ? null
              : input.content,
        },
      });
      await load();
    } catch (addError: unknown) {
      setError(errorText(addError));
    } finally {
      setWorking(false);
    }
  };

  if (loading && workspace === null)
    return (
      <main className="ingestion-desk ingestion-loading">
        Loading Ingestion Desk…
      </main>
    );
  if (workspace === null)
    return (
      <main className="ingestion-desk ingestion-loading" role="alert">
        {error ?? "Ingestion Desk is unavailable."}
      </main>
    );

  const openCount = workspace.cases.filter(
    (item) => item.status !== "published",
  ).length;

  return (
    <main className="ingestion-desk">
      <header className="ingestion-header">
        <div>
          <p className="ingestion-eyebrow">Vault operations</p>
          <h1>Ingestion Desk</h1>
          <p className="ingestion-subtitle">
            Review meeting sources, keep their provenance, then publish directly
            to main.
          </p>
        </div>
        <button
          className="ingestion-button ingestion-button-secondary"
          type="button"
          onClick={() => setShowAddForm((open) => !open)}
          aria-expanded={showAddForm}
        >
          {showAddForm ? "Close intake" : "Add sources"}
        </button>
      </header>

      {showAddForm ? (
        <AddCaseForm
          projects={workspace.projects}
          onCreate={createCase}
          pending={working}
        />
      ) : null}
      {error ? (
        <p className="ingestion-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="ingestion-layout">
        <aside className="ingestion-queue" aria-label="Ingestion cases">
          <div className="ingestion-queue-heading">
            <span>Open cases</span>
            <span className="ingestion-count">{openCount}</span>
          </div>
          <div className="ingestion-case-list">
            {workspace.cases.length === 0 ? (
              <p className="ingestion-empty">
                Add a Drive link, notes, or a transcript to start.
              </p>
            ) : (
              workspace.cases.map((item) => (
                <button
                  key={item.id}
                  className="ingestion-case"
                  type="button"
                  aria-current={selectedId === item.id ? "page" : undefined}
                  onClick={() => selectCase(item.id)}
                >
                  <span
                    className={`ingestion-status ingestion-status-${item.status}`}
                    aria-hidden="true"
                  />
                  <span className="ingestion-case-copy">
                    <strong>{item.title}</strong>
                    <span>
                      {item.sources.length} source
                      {item.sources.length === 1 ? "" : "s"} ·{" "}
                      {statusLabel(item.status)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
          {selected ? <GitParityCard git={selected.git} /> : null}
        </aside>

        {selected ? (
          <section
            className="ingestion-detail-wrap"
            aria-label="Selected ingestion case"
          >
            <article
              className="ingestion-detail t-panel-slide"
              data-open={detailVisible}
            >
              <header className="ingestion-detail-header">
                <div>
                  <p className="ingestion-eyebrow">
                    {statusLabel(selected.status)}
                  </p>
                  <h2>{selected.title}</h2>
                  <p>{selected.summary}</p>
                </div>
                <div className="ingestion-actions">
                  {selected.status === "inbox" ||
                  selected.status === "needs_context" ? (
                    <button
                      className="ingestion-button ingestion-button-primary"
                      type="button"
                      disabled={working}
                      onClick={() => void runAction("startDraft", selected.id)}
                    >
                      {working ? "Working…" : "Generate draft"}
                    </button>
                  ) : null}
                  {selected.status === "ready" ? (
                    <button
                      className="ingestion-button ingestion-button-primary"
                      type="button"
                      disabled={working || selected.git.state === "blocked"}
                      onClick={() => void runAction("publishCase", selected.id)}
                    >
                      {working ? "Publishing…" : "Publish to main"}
                    </button>
                  ) : null}
                  {selected.status === "sync_blocked" ? (
                    <button
                      className="ingestion-button ingestion-button-primary"
                      type="button"
                      disabled={working}
                      onClick={() =>
                        void runAction("publishCase", selected.id, true)
                      }
                    >
                      {working ? "Preserving…" : "Preserve and sync"}
                    </button>
                  ) : null}
                  <button
                    className="ingestion-icon-button"
                    type="button"
                    onClick={() => void runAction("refreshCase", selected.id)}
                    disabled={working}
                    aria-label="Refresh case"
                  >
                    ↻
                  </button>
                </div>
              </header>

              <div
                className="t-tabs ingestion-tabs"
                ref={tabsRef}
                role="tablist"
                aria-label="Case detail views"
              >
                <span className="t-tabs-pill" aria-hidden="true" />
                {["sources", "details", "review"].map((view) => (
                  <button
                    key={view}
                    className="t-tab"
                    data-view={view}
                    role="tab"
                    type="button"
                    aria-selected={activeView === view}
                    onClick={() => {
                      setActiveView(view);
                      tabsMove(tabsRef.current, view, true);
                    }}
                  >
                    {view[0]!.toUpperCase() + view.slice(1)}
                  </button>
                ))}
              </div>

              {activeView === "sources" ? (
                <SourcesView
                  item={selected}
                  pending={working}
                  onAdd={addSource}
                />
              ) : null}
              {activeView === "details" ? (
                <DetailsView
                  item={selected}
                  saving={working}
                  onSave={updateDetails}
                />
              ) : null}
              {activeView === "review" ? <ReviewView item={selected} /> : null}
            </article>
          </section>
        ) : (
          <section className="ingestion-empty-detail">
            <h2>No case selected</h2>
            <p>Add a source to create your first ingestion case.</p>
          </section>
        )}
      </div>
    </main>
  );
}

function GitParityCard({ git }: { git: GitParity }) {
  const parity = git.state === "ready" || git.state === "published";
  const blocked = git.state === "blocked";
  const status = parity
    ? "In parity"
    : blocked
      ? "Needs review"
      : git.state === "not_checked"
        ? "Checked during publish"
        : "Unavailable";
  const message = blocked
    ? (git.message ??
      "Automatic sync paused. Review local changes before publishing.")
    : git.state === "not_checked"
      ? "BB checks Git parity during publish."
      : git.message;
  return (
    <section
      className={`ingestion-git ${blocked ? "ingestion-git-blocked" : ""}`}
      aria-label="Vault Git parity"
    >
      <div className="ingestion-git-title">
        <span>Vault sync</span>
        <span>{status}</span>
      </div>
      <dl>
        <div>
          <dt>Local Vault</dt>
          <dd>{git.localHead?.slice(0, 7) ?? "Not checked"}</dd>
        </div>
        <div>
          <dt>GitHub</dt>
          <dd>{git.remoteHead?.slice(0, 7) ?? "Not checked"}</dd>
        </div>
        <div>
          <dt>Publish target</dt>
          <dd>main</dd>
        </div>
      </dl>
      {message ? <p>{message}</p> : null}
    </section>
  );
}

function SourcesView({
  item,
  pending,
  onAdd,
}: {
  item: IngestionCase;
  pending: boolean;
  onAdd: (
    caseId: string,
    input: { sourceKind: SourceKind; label: string; content: string },
  ) => void;
}) {
  const [adding, setAdding] = useState(false);
  const { sources, provenance } = item;
  return (
    <div className="ingestion-view">
      <section>
        <div className="ingestion-section-heading">
          <h3>Sources</h3>
          {item.status === "inbox" || item.status === "needs_context" ? (
            <button
              className="ingestion-button ingestion-button-secondary"
              type="button"
              onClick={() => setAdding((open) => !open)}
            >
              {adding ? "Close" : "Add source"}
            </button>
          ) : null}
        </div>
        {adding ? (
          <AddSourceForm
            caseId={item.id}
            pending={pending}
            onAdd={(input) => onAdd(item.id, input)}
          />
        ) : null}
        <div className="ingestion-source-list">
          {sources.map((source) => (
            <article className="ingestion-source-card" key={source.id}>
              <div>
                <p>{sourceKindLabel(source.kind)}</p>
                <h4>{source.label}</h4>
                <span>{source.description}</span>
              </div>
              <div className="ingestion-source-meta">
                <span className="ingestion-authority">{source.authority}</span>
                {source.url ? (
                  <a
                    className="ingestion-button ingestion-button-secondary"
                    href={source.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open source
                  </a>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="ingestion-provenance">
        <h3>Provenance</h3>
        {provenance.length === 0 ? (
          <p>No provenance has been recorded yet.</p>
        ) : (
          provenance.map((entry) => (
            <article key={entry.id}>
              <strong>{entry.kind}</strong>
              <p>{entry.message}</p>
              <span>
                Source:{" "}
                {entry.sourceId === null
                  ? "Ingestion Desk"
                  : (sources.find((source) => source.id === entry.sourceId)
                      ?.label ?? entry.sourceId)}
              </span>
            </article>
          ))
        )}
      </section>
    </div>
  );
}

function DetailsView({
  item,
  saving,
  onSave,
}: {
  item: IngestionCase;
  saving: boolean;
  onSave: (id: string, details: Detail) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(item.details.date ?? "");
  const [project, setProject] = useState(item.details.project ?? "");
  const [attendees, setAttendees] = useState(item.details.attendees.join(", "));
  const [meetingType, setMeetingType] = useState(
    item.details.meetingType ?? "",
  );
  const fields = [
    ["Date", item.details.date],
    ["Project", item.details.project],
    ["Attendees", item.details.attendees.join(", ")],
    ["Meeting type", item.details.meetingType],
  ];
  const save = (event: FormEvent) => {
    event.preventDefault();
    onSave(item.id, {
      date: date || null,
      project: project || null,
      attendees: attendees
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
      meetingType: meetingType || null,
    });
  };
  return (
    <div className="ingestion-view">
      <section>
        <h3>Detected details</h3>
        <dl className="ingestion-details">
          {fields.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value || "Not set"}</dd>
            </div>
          ))}
        </dl>
      </section>
      {item.status === "needs_context" ? (
        <section className="ingestion-question">
          <h3>Confirmation needed</h3>
          <p>Confirm the detected details before you generate a Vault draft.</p>
          {editing ? (
            <form className="ingestion-details-form" onSubmit={save}>
              <label>
                Date
                <input
                  aria-label="Meeting date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </label>
              <label>
                Project
                <input
                  aria-label="Meeting project"
                  value={project}
                  onChange={(event) => setProject(event.target.value)}
                />
              </label>
              <label>
                Attendees
                <input
                  aria-label="Meeting attendees"
                  value={attendees}
                  onChange={(event) => setAttendees(event.target.value)}
                />
              </label>
              <label>
                Meeting type
                <input
                  aria-label="Meeting type"
                  value={meetingType}
                  onChange={(event) => setMeetingType(event.target.value)}
                />
              </label>
              <div>
                <button
                  className="ingestion-button ingestion-button-primary"
                  type="submit"
                  disabled={saving}
                >
                  {saving ? "Saving…" : "Save details"}
                </button>
                <button
                  className="ingestion-button ingestion-button-secondary"
                  type="button"
                  disabled={saving}
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              className="ingestion-button ingestion-button-secondary"
              type="button"
              onClick={() => setEditing(true)}
            >
              Correct details
            </button>
          )}
        </section>
      ) : null}
    </div>
  );
}

function ReviewView({ item }: { item: IngestionCase }) {
  const parity = item.git.state === "ready" || item.git.state === "published";
  const blocked = item.git.state === "blocked";
  const title = parity
    ? "Ready to publish"
    : blocked
      ? "Sync needs review"
      : "Git check pending";
  const message = parity
    ? "This case will commit directly to main and fast-forward the local Vault."
    : blocked
      ? (item.git.message ?? "Local changes block direct publication.")
      : "BB checks Git parity during publish.";
  return (
    <div className="ingestion-view ingestion-review">
      <section>
        <h3>Proposed Vault changes</h3>
        <ul className="ingestion-output-list">
          {item.outputs.map((output) => (
            <li key={output.path}>
              <span className="ingestion-output-dot ingestion-output-ready" />
              {output.path}
              <span>{output.summary}</span>
            </li>
          ))}
        </ul>
      </section>
      <section
        className={
          blocked ? "ingestion-publish-blocked" : "ingestion-publish-ready"
        }
      >
        <h3>{title}</h3>
        <p>{message}</p>
      </section>
    </div>
  );
}

export { parseBootstrap, parseCase };

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "ingestion-desk",
    title: "Ingestion",
    icon: "Inbox",
    path: "ingestion",
    component: IngestionDesk,
  });
});
