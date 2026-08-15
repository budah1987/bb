import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DragEvent, FormEvent } from "react";
import {
  Markdown,
  definePluginApp,
  useBbContext,
  useRealtime,
  useRpc,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import {
  bootstrapOutputSchema,
  type IngestionCase,
  type IngestionDetails,
  type IngestionSourceInput,
  type MeetingBriefing,
  type ProjectSummary,
} from "./contract.js";
import type { ingestionRpcContract } from "./server.js";
import "./app.css";

type DeskView = "ingest" | "projects";

interface LocalFile {
  name: string;
  content: string;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function statusLabel(status: IngestionCase["status"]): string {
  return {
    inbox: "Waiting",
    needs_context: "Needs context",
    drafting: "Processing",
    ready: "Ready for approval",
    publishing: "Writing to Vault",
    published: "Published",
    sync_blocked: "Sync blocked",
  }[status];
}

function sourceLabel(kind: IngestionSourceInput["kind"]): string {
  return {
    upload: "File",
    pasted: "Pasted text",
    drive_link: "Google Drive",
    granola_paste: "Granola",
    url: "Link",
  }[kind];
}

function isDriveUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname;
    return hostname === "drive.google.com" || hostname === "docs.google.com";
  } catch {
    return false;
  }
}

export function composerSources(
  text: string,
  files: LocalFile[],
): IngestionSourceInput[] {
  const sources: IngestionSourceInput[] = files.map((file) => ({
    kind: "upload",
    label: file.name,
    authority: "primary",
    url: null,
    content: file.content,
  }));
  const textLines: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^https?:\/\/\S+$/.test(trimmed)) {
      const drive = isDriveUrl(trimmed);
      sources.push({
        kind: drive ? "drive_link" : "url",
        label: drive ? "Google Drive document" : "Meeting context link",
        authority: drive ? "primary" : "context",
        url: trimmed,
        content: null,
      });
    } else {
      textLines.push(line);
    }
  }
  const captured = textLines.join("\n").trim();
  if (captured.length > 0) {
    sources.unshift({
      kind: "granola_paste",
      label: "Pasted notes and transcript",
      authority: "primary",
      url: null,
      content: captured,
    });
  }
  return sources;
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
    const previous = pill.style.transition;
    pill.style.transition = "none";
    pill.style.transform = `translateX(${tab.offsetLeft}px)`;
    pill.style.width = `${tab.offsetWidth}px`;
    void pill.offsetWidth;
    pill.style.transition = previous;
    return;
  }
  pill.style.transform = `translateX(${tab.offsetLeft}px)`;
  pill.style.width = `${tab.offsetWidth}px`;
}

function DeskTabs({
  active,
  onChange,
}: {
  active: DeskView;
  onChange: (view: DeskView) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => tabsMove(barRef.current, active, false), [active]);
  useEffect(() => {
    const resize = () => tabsMove(barRef.current, active, false);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [active]);
  return (
    <div className="t-tabs desk-tabs" ref={barRef} role="tablist">
      <span className="t-tabs-pill" aria-hidden="true" />
      {(["ingest", "projects"] as const).map((view) => (
        <button
          className="t-tab"
          data-view={view}
          key={view}
          role="tab"
          type="button"
          aria-selected={active === view}
          onClick={() => {
            onChange(view);
            tabsMove(barRef.current, view, true);
          }}
        >
          {view === "ingest" ? "Ingest" : "Projects"}
        </button>
      ))}
    </div>
  );
}

function IntakeComposer({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (input: {
    text: string;
    context: string;
    files: LocalFile[];
  }) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [context, setContext] = useState("");
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasMaterial = composerSources(text, files).length > 0;

  const addFiles = async (incoming: FileList | File[]) => {
    const next = await Promise.all(
      Array.from(incoming).map(async (file) => ({
        name: file.name,
        content: await file.text(),
      })),
    );
    setFiles((current) => [...current, ...next]);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!hasMaterial || pending) return;
    const accepted = await onSubmit({ text, context, files });
    if (!accepted) return;
    setText("");
    setContext("");
    setFiles([]);
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void addFiles(event.dataTransfer.files);
  };

  return (
    <form className="intake" onSubmit={(event) => void submit(event)}>
      <div className="intake-heading">
        <div>
          <p className="desk-kicker">New meeting</p>
          <h2>Bring everything. BB will sort it out.</h2>
        </div>
        <span>Notes + transcript become one meeting</span>
      </div>
      <div
        className="intake-dropzone"
        data-dragging={dragging}
        onDragEnter={() => setDragging(true)}
        onDragLeave={() => setDragging(false)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={drop}
      >
        <textarea
          aria-label="Meeting material"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onPointerDownCapture={(event) => {
            event.stopPropagation();
            event.currentTarget.focus();
          }}
          onPaste={(event) => event.stopPropagation()}
          placeholder="Paste Granola notes, a transcript, Google Drive links, or GitHub links…"
        />
        <div className="intake-tools">
          <button
            className="desk-button desk-button-quiet"
            type="button"
            onClick={() => inputRef.current?.click()}
          >
            Attach files
          </button>
          <span>Drop text files anywhere in this area</span>
          <input
            ref={inputRef}
            className="desk-visually-hidden"
            type="file"
            multiple
            accept=".txt,.md,.text,text/plain,text/markdown"
            onChange={(event) => {
              if (event.target.files) void addFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </div>
      </div>
      {files.length > 0 ? (
        <ul className="intake-files" aria-label="Attached files">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`}>
              <span>{file.name}</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() =>
                  setFiles((current) =>
                    current.filter((_, fileIndex) => fileIndex !== index),
                  )
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <label className="intake-context">
        <span>Context <small>Optional</small></span>
        <input
          value={context}
          onChange={(event) => setContext(event.target.value)}
          onPointerDownCapture={(event) => {
            event.stopPropagation();
            event.currentTarget.focus();
          }}
          placeholder="For example: Spencer discussed the allocation table for warehouse2/ecto"
        />
      </label>
      <div className="intake-submit">
        <p>BB will infer the date, project, people, and source roles.</p>
        <button
          className="desk-button desk-button-primary"
          type="submit"
          disabled={!hasMaterial || pending}
        >
          {pending ? "Starting…" : "Ingest meeting"}
        </button>
      </div>
    </form>
  );
}

function ProcessingState({ item }: { item: IngestionCase }) {
  return (
    <section className="processing t-panel-slide" data-open="true" aria-live="polite">
      <span className="processing-mark" aria-hidden="true" />
      <div>
        <p className="desk-kicker">Processing meeting</p>
        <h2>{item.title}</h2>
        <p>BB is reading sources and checking your Vault.</p>
        <ol>
          <li>Combine notes, transcripts, and linked context</li>
          <li>Find the project, people, and earlier decisions</li>
          <li>Prepare the full Vault package for approval</li>
        </ol>
      </div>
    </section>
  );
}

function BriefingList({
  title,
  items,
  empty,
}: {
  title: string;
  items: string[];
  empty: string;
}) {
  return (
    <section className="briefing-section">
      <h3>{title}</h3>
      {items.length > 0 ? (
        <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
      ) : (
        <p className="briefing-empty">{empty}</p>
      )}
    </section>
  );
}

function BriefingBody({ briefing }: { briefing: MeetingBriefing }) {
  return (
    <div className="briefing-grid">
      <BriefingList title="Decisions" items={briefing.decisions} empty="No firm decisions found." />
      <BriefingList title="Insights" items={briefing.insights} empty="No new insight found." />
      <section className="briefing-section">
        <h3>Actions</h3>
        {briefing.actions.length > 0 ? (
          <ul>
            {briefing.actions.map((item) => (
              <li key={`${item.action}-${item.owner ?? ""}`}>
                {item.action}
                {item.owner ? <span className="action-owner">{item.owner}</span> : null}
              </li>
            ))}
          </ul>
        ) : <p className="briefing-empty">No clear actions found.</p>}
      </section>
      <BriefingList title="Project effects" items={briefing.projectEffects} empty="No project guidance changed." />
      <BriefingList title="Risks" items={briefing.risks} empty="No material risks found." />
      <BriefingList title="Open questions" items={briefing.openQuestions} empty="No open questions found." />
    </div>
  );
}

function CorrectionEditor({
  item,
  pending,
  onRevise,
}: {
  item: IngestionCase;
  pending: boolean;
  onRevise: (title: string, details: IngestionDetails) => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [date, setDate] = useState(item.details.date ?? "");
  const [project, setProject] = useState(item.details.project ?? "");
  const [attendees, setAttendees] = useState(item.details.attendees.join(", "));
  const [meetingType, setMeetingType] = useState(item.details.meetingType ?? "");
  const changed =
    title !== item.title ||
    date !== (item.details.date ?? "") ||
    project !== (item.details.project ?? "") ||
    attendees !== item.details.attendees.join(", ") ||
    meetingType !== (item.details.meetingType ?? "");
  return (
    <section className="corrections" aria-label="Meeting details">
      <label className="correction-title">
        <span>Title</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <div className="correction-grid">
        <label><span>Date</span><input value={date} onChange={(event) => setDate(event.target.value)} placeholder="YYYY-MM-DD" /></label>
        <label><span>Project</span><input value={project} onChange={(event) => setProject(event.target.value)} /></label>
        <label><span>People</span><input value={attendees} onChange={(event) => setAttendees(event.target.value)} placeholder="Names separated by commas" /></label>
        <label><span>Meeting type</span><input value={meetingType} onChange={(event) => setMeetingType(event.target.value)} /></label>
      </div>
      {changed ? (
        <div className="correction-save">
          <p>BB will update the briefing and every proposed file.</p>
          <button
            className="desk-button desk-button-secondary"
            type="button"
            disabled={pending || title.trim().length === 0}
            onClick={() => onRevise(title.trim(), {
              date: date.trim() || null,
              project: project.trim() || null,
              attendees: attendees.split(",").map((name) => name.trim()).filter(Boolean),
              meetingType: meetingType.trim() || null,
            })}
          >
            Apply corrections
          </button>
        </div>
      ) : null}
    </section>
  );
}

function SourceAndOutputDetails({ item }: { item: IngestionCase }) {
  return (
    <div className="secondary-details">
      <details>
        <summary>Sources <span>{item.sources.length}</span></summary>
        <ul>
          {item.sources.map((source) => (
            <li key={source.id}>
              <div><strong>{source.label}</strong><span>{sourceLabel(source.kind)} · {source.description}</span></div>
              {source.url ? <a href={source.url} target="_blank" rel="noreferrer">Open</a> : null}
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary>Proposed Vault changes <span>{item.outputs.length}</span></summary>
        <ul>
          {item.outputs.map((output) => (
            <li key={output.path}><div><strong>{output.path}</strong><span>{output.summary}</span></div></li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function GitLine({ item }: { item: IngestionCase }) {
  const git = item.git;
  const label = git.state === "published" ? "Local and GitHub match" : git.state === "blocked" ? "Git needs attention" : "Git checks during approval";
  return (
    <div className="git-line">
      <span className={`git-dot git-dot-${git.state}`} aria-hidden="true" />
      <span>{label}</span>
      <span>main</span>
      {git.publishedCommit ? <code>{git.publishedCommit.slice(0, 7)}</code> : null}
    </div>
  );
}

function MeetingReview({
  item,
  pending,
  onPublish,
  onRevise,
}: {
  item: IngestionCase;
  pending: boolean;
  onPublish: (preserve: boolean) => void;
  onRevise: (title: string, details: IngestionDetails) => void;
}) {
  if (item.status === "drafting" || item.status === "inbox") return <ProcessingState item={item} />;
  if (item.draft === null) return null;
  const published = item.status === "published";
  const blocked = item.status === "sync_blocked";
  return (
    <article className="meeting-review t-panel-slide" data-open="true">
      <header className="review-heading">
        <div>
          <p className="desk-kicker">{statusLabel(item.status)}</p>
          <h2>{published ? item.title : "Meeting briefing"}</h2>
          <p>{item.summary}</p>
        </div>
        <span className={`review-state review-state-${item.status}`}>{statusLabel(item.status)}</span>
      </header>
      {!published && !blocked ? <CorrectionEditor item={item} pending={pending} onRevise={onRevise} /> : null}
      {item.draft.briefing.uncertainties.length > 0 ? (
        <section className="uncertainties">
          <h3>Check these details</h3>
          <ul>{item.draft.briefing.uncertainties.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
      ) : null}
      <BriefingBody briefing={item.draft.briefing} />
      <details className="full-synthesis">
        <summary>Full meeting synthesis</summary>
        <Markdown content={item.draft.markdown} />
      </details>
      <SourceAndOutputDetails item={item} />
      <footer className="review-footer">
        <GitLine item={item} />
        {blocked ? (
          <div className="blocked-action">
            <p>{item.git.message ?? "BB could not safely update main."}</p>
            <button className="desk-button desk-button-primary" type="button" disabled={pending} onClick={() => onPublish(true)}>
              {pending ? "Preserving…" : "Preserve and sync"}
            </button>
          </div>
        ) : item.status === "ready" ? (
          <button className="desk-button desk-button-primary" type="button" disabled={pending} onClick={() => onPublish(false)}>
            {pending ? "Writing…" : "Approve and write"}
          </button>
        ) : null}
      </footer>
    </article>
  );
}

function RecentMeetings({
  cases,
  selectedId,
  onSelect,
}: {
  cases: IngestionCase[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (cases.length === 0) return null;
  return (
    <section className="recent-meetings">
      <div className="section-heading"><h2>Recent meetings</h2><span>{cases.length}</span></div>
      <div className="recent-list">
        {cases.slice(0, 8).map((item) => (
          <button key={item.id} type="button" aria-current={selectedId === item.id ? "true" : undefined} onClick={() => onSelect(item.id)}>
            <span className={`meeting-status meeting-status-${item.status}`} aria-hidden="true" />
            <span><strong>{item.title}</strong><small>{item.details.project ?? statusLabel(item.status)}</small></span>
            <time>{item.details.date ?? ""}</time>
          </button>
        ))}
      </div>
    </section>
  );
}

function ProjectMeeting({ item }: { item: IngestionCase }) {
  if (item.draft === null) return null;
  return (
    <details className="project-meeting">
      <summary>
        <span><strong>{item.title}</strong><small>{item.summary}</small></span>
        <time>{item.details.date ?? "Date unknown"}</time>
      </summary>
      <BriefingBody briefing={item.draft.briefing} />
      <details className="full-synthesis"><summary>Meeting notes</summary><Markdown content={item.draft.markdown} /></details>
    </details>
  );
}

function ProjectsView({ cases }: { cases: IngestionCase[] }) {
  const grouped = useMemo(() => {
    const groups = new Map<string, IngestionCase[]>();
    for (const item of cases) {
      if (item.draft === null) continue;
      const name = item.details.project ?? "Needs project";
      const group = groups.get(name);
      if (group) group.push(item);
      else groups.set(name, [item]);
    }
    return groups;
  }, [cases]);
  const names = [...grouped.keys()].sort((a, b) => a.localeCompare(b));
  const [selected, setSelected] = useState(names[0] ?? "");
  useEffect(() => {
    if (!grouped.has(selected)) setSelected(names[0] ?? "");
  }, [grouped, names, selected]);
  const meetings = grouped.get(selected) ?? [];
  const combined = meetings.reduce<MeetingBriefing>((result, item) => {
    const briefing = item.draft?.briefing;
    if (!briefing) return result;
    result.decisions.push(...briefing.decisions);
    result.insights.push(...briefing.insights);
    result.actions.push(...briefing.actions);
    result.risks.push(...briefing.risks);
    result.openQuestions.push(...briefing.openQuestions);
    result.uncertainties.push(...briefing.uncertainties);
    result.projectEffects.push(...briefing.projectEffects);
    return result;
  }, { decisions: [], insights: [], actions: [], risks: [], openQuestions: [], uncertainties: [], projectEffects: [] });

  if (names.length === 0) {
    return <section className="projects-empty"><p className="desk-kicker">Projects</p><h2>Your meeting library starts after the first briefing.</h2><p>Approved and review-ready meetings will appear here by inferred Vault project.</p></section>;
  }
  return (
    <div className="projects-layout">
      <aside className="project-index" aria-label="Meeting projects">
        <p className="desk-kicker">Projects</p>
        {names.map((name) => (
          <button type="button" key={name} aria-current={selected === name ? "page" : undefined} onClick={() => setSelected(name)}>
            <span>{name}</span><small>{grouped.get(name)?.length ?? 0}</small>
          </button>
        ))}
      </aside>
      <section className="project-intelligence">
        <header><p className="desk-kicker">Meeting intelligence</p><h2>{selected}</h2><p>{meetings.length} meeting{meetings.length === 1 ? "" : "s"} in this project.</p></header>
        <BriefingBody briefing={combined} />
        <div className="project-history">
          <div className="section-heading"><h2>Meeting notes</h2><span>{meetings.length}</span></div>
          {meetings.map((item) => <ProjectMeeting item={item} key={item.id} />)}
        </div>
      </section>
    </div>
  );
}

function IngestionDesk(_props: PluginNavPanelProps) {
  const rpc = useRpc<typeof ingestionRpcContract>();
  const context = useBbContext();
  const [workspace, setWorkspace] = useState<{ cases: IngestionCase[]; projects: ProjectSummary[] } | null>(null);
  const [activeView, setActiveView] = useState<DeskView>("ingest");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = bootstrapOutputSchema.parse(await rpc.call("bootstrap", { projectId: null }));
      setWorkspace(next);
      setSelectedId((current) => current && next.cases.some((item) => item.id === current) ? current : null);
    } catch (loadError) {
      setError(errorText(loadError));
    }
  }, [rpc]);

  useEffect(() => { void load(); }, [load]);
  useRealtime("ingestion:changed", () => { void load(); });

  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    setWorking(true);
    setError(null);
    try {
      await action();
      await load();
      return true;
    } catch (actionError) {
      setError(errorText(actionError));
      return false;
    } finally {
      setWorking(false);
    }
  };

  if (workspace === null) return <main className="ingestion-desk desk-loading">{error ?? "Loading Ingestion Desk…"}</main>;
  const selected = workspace.cases.find((item) => item.id === selectedId) ?? null;
  const preferredProjectId = workspace.projects.some((project) => project.id === context.projectId) ? context.projectId : (workspace.projects[0]?.id ?? null);

  return (
    <main className="ingestion-desk">
      <header className="desk-header">
        <div><p className="desk-kicker">Vault meeting intelligence</p><h1>Ingestion Desk</h1></div>
        <DeskTabs active={activeView} onChange={setActiveView} />
      </header>
      {error ? <p className="desk-error" role="alert">{error}</p> : null}
      {activeView === "ingest" ? (
        <div className="ingest-workspace">
          <IntakeComposer pending={working} onSubmit={(input) => run(async () => {
            const created = await rpc.call("ingestMeeting", {
              projectId: preferredProjectId,
              context: input.context,
              sources: composerSources(input.text, input.files),
            });
            const parsed = bootstrapOutputSchema.shape.cases.element.parse(created);
            setSelectedId(parsed.id);
          })} />
          {selected ? <MeetingReview item={selected} pending={working} onPublish={(preserve) => void run(() => rpc.call("publishCase", { caseId: selected.id, preserveLocalChanges: preserve }))} onRevise={(title, details) => void run(() => rpc.call("reviseCase", { caseId: selected.id, title, details }))} /> : null}
          <RecentMeetings cases={workspace.cases} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setActiveView("ingest"); }} />
        </div>
      ) : <ProjectsView cases={workspace.cases} />}
    </main>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "ingestion-desk",
    title: "Ingestion",
    icon: "Inbox",
    path: "ingestion",
    component: IngestionDesk,
  });
});
