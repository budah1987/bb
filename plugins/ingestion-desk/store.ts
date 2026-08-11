import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  ingestionCaseSchema,
  ingestionDetailsSchema,
  ingestionSourceSchema,
  type GitParity,
  type IngestionCase,
  type IngestionDetails,
  type IngestionOutput,
  type IngestionSource,
  type IngestionSourceInput,
  type MeetingBriefing,
} from "./contract.js";

const emptyDetails: IngestionDetails = {
  date: null,
  project: null,
  attendees: [],
  meetingType: null,
};
const defaultGit: GitParity = {
  state: "not_checked",
  localHead: null,
  remoteHead: null,
  publishedCommit: null,
  message: null,
};
const emptyBriefing: MeetingBriefing = {
  decisions: [],
  insights: [],
  actions: [],
  risks: [],
  openQuestions: [],
  uncertainties: [],
  projectEffects: [],
};

type CaseRow = {
  id: string;
  project_id: string;
  title: string;
  summary: string;
  status: string;
  details_json: string;
  draft_markdown: string | null;
  briefing_json: string | null;
  outputs_json: string | null;
  draft_thread_id: string | null;
  reviewed_at: string | null;
  git_json: string;
  created_at: string;
  updated_at: string;
};
type SourceRow = {
  id: string;
  case_id: string;
  kind: string;
  label: string;
  authority: string;
  url: string | null;
  content: string | null;
  content_length: number | null;
  sha256: string | null;
  created_at: string;
};
type ProvenanceRow = {
  id: string;
  case_id: string;
  kind: string;
  message: string;
  source_id: string | null;
  created_at: string;
};

export const migrations = [
  `CREATE TABLE IF NOT EXISTS ingestion_cases (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    status TEXT NOT NULL,
    details_json TEXT NOT NULL,
    draft_markdown TEXT,
    outputs_json TEXT,
    draft_thread_id TEXT,
    reviewed_at TEXT,
    git_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ingestion_cases_project_status_updated_idx
    ON ingestion_cases(project_id, status, updated_at DESC);
  CREATE TABLE IF NOT EXISTS ingestion_sources (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL REFERENCES ingestion_cases(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    authority TEXT NOT NULL,
    url TEXT,
    content TEXT,
    sha256 TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ingestion_sources_case_idx ON ingestion_sources(case_id, created_at);
  CREATE UNIQUE INDEX IF NOT EXISTS ingestion_sources_case_sha_idx
    ON ingestion_sources(case_id, sha256) WHERE sha256 IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS ingestion_sources_case_url_idx
    ON ingestion_sources(case_id, url) WHERE url IS NOT NULL;
  CREATE TABLE IF NOT EXISTS ingestion_provenance (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL REFERENCES ingestion_cases(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    source_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ingestion_provenance_case_idx ON ingestion_provenance(case_id, created_at);`,
  `ALTER TABLE ingestion_sources ADD COLUMN content_length INTEGER;
  UPDATE ingestion_sources
  SET content_length = length(content)
  WHERE content IS NOT NULL;`,
  `ALTER TABLE ingestion_cases ADD COLUMN briefing_json TEXT;`,
];

function now(): string {
  return new Date().toISOString();
}

function hash(content: string | null): string | null {
  return content === null
    ? null
    : createHash("sha256").update(content, "utf8").digest("hex");
}

function sourceDescription(
  source: Pick<IngestionSource, "url" | "content" | "contentLength">,
): string {
  if (source.url !== null) return source.url;
  const contentLength = source.content?.length ?? source.contentLength;
  return contentLength === null
    ? "No captured content"
    : `${contentLength.toLocaleString()} characters captured`;
}

function groupByCaseId<Row extends { case_id: string }>(
  rows: Row[],
): Map<string, Row[]> {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const group = grouped.get(row.case_id);
    if (group) group.push(row);
    else grouped.set(row.case_id, [row]);
  }
  return grouped;
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`Stored Ingestion Desk ${label} is invalid`);
  }
}

export class IngestionStore {
  constructor(private readonly db: Database.Database) {}

  private sourceFromRow(row: SourceRow): IngestionSource {
    return ingestionSourceSchema.parse({
      id: row.id,
      kind: row.kind,
      label: row.label,
      authority: row.authority,
      url: row.url,
      content: row.content,
      contentLength: row.content_length,
      sha256: row.sha256,
      description: sourceDescription({
        url: row.url,
        content: row.content,
        contentLength: row.content_length,
      }),
      createdAt: row.created_at,
    });
  }

  private caseFromRow(
    row: CaseRow,
    sourceRows: SourceRow[],
    provenanceRows: ProvenanceRow[],
  ): IngestionCase {
    const sources = sourceRows.map((source) => this.sourceFromRow(source));
    const provenance = provenanceRows.map((item) => ({
      id: item.id,
      kind: item.kind,
      message: item.message,
      sourceId: item.source_id,
      createdAt: item.created_at,
    }));
    const outputs =
      row.outputs_json === null ? [] : parseJson(row.outputs_json, "outputs");
    const details = ingestionDetailsSchema.parse(
      parseJson(row.details_json, "details"),
    );
    const git = parseJson(row.git_json, "Git state");
    return ingestionCaseSchema.parse({
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      summary: row.summary,
      status: row.status,
      details,
      sources,
      provenance,
      outputs,
      draft:
        row.draft_markdown === null && row.draft_thread_id === null
          ? null
          : {
              markdown: row.draft_markdown ?? "",
              briefing:
                row.briefing_json === null
                  ? emptyBriefing
                  : parseJson(row.briefing_json, "briefing"),
              outputs,
              draftThreadId: row.draft_thread_id,
              reviewedAt: row.reviewed_at,
            },
      git,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  private row(caseId: string): CaseRow {
    const row = this.db
      .prepare<[string], CaseRow>("SELECT * FROM ingestion_cases WHERE id = ?")
      .get(caseId);
    if (!row) throw new Error(`Unknown ingestion case: ${caseId}`);
    return row;
  }

  get(caseId: string): IngestionCase {
    const sources = this.db
      .prepare<
        [string],
        SourceRow
      >("SELECT * FROM ingestion_sources WHERE case_id = ? ORDER BY created_at, id")
      .all(caseId);
    const provenance = this.db
      .prepare<
        [string],
        ProvenanceRow
      >("SELECT * FROM ingestion_provenance WHERE case_id = ? ORDER BY created_at, id")
      .all(caseId);
    return this.caseFromRow(this.row(caseId), sources, provenance);
  }

  listSummaries(projectId: string | null): IngestionCase[] {
    const rows =
      projectId === null
        ? this.db
            .prepare<
              [],
              CaseRow
            >("SELECT * FROM ingestion_cases ORDER BY updated_at DESC, id DESC")
            .all()
        : this.db
            .prepare<
              [string],
              CaseRow
            >("SELECT * FROM ingestion_cases WHERE project_id = ? ORDER BY updated_at DESC, id DESC")
            .all(projectId);
    const sourceRows =
      projectId === null
        ? this.db
            .prepare<
              [],
              SourceRow
            >("SELECT id, case_id, kind, label, authority, url, NULL AS content, content_length, sha256, created_at FROM ingestion_sources ORDER BY case_id, created_at, id")
            .all()
        : this.db
            .prepare<
              [string],
              SourceRow
            >("SELECT source.id, source.case_id, source.kind, source.label, source.authority, source.url, NULL AS content, source.content_length, source.sha256, source.created_at FROM ingestion_sources source JOIN ingestion_cases ingestion_case ON ingestion_case.id = source.case_id WHERE ingestion_case.project_id = ? ORDER BY source.case_id, source.created_at, source.id")
            .all(projectId);
    const provenanceRows =
      projectId === null
        ? this.db
            .prepare<
              [],
              ProvenanceRow
            >("SELECT * FROM ingestion_provenance ORDER BY case_id, created_at, id")
            .all()
        : this.db
            .prepare<
              [string],
              ProvenanceRow
            >("SELECT provenance.* FROM ingestion_provenance provenance JOIN ingestion_cases ingestion_case ON ingestion_case.id = provenance.case_id WHERE ingestion_case.project_id = ? ORDER BY provenance.case_id, provenance.created_at, provenance.id")
            .all(projectId);
    const sourcesByCaseId = groupByCaseId(sourceRows);
    const provenanceByCaseId = groupByCaseId(provenanceRows);
    return rows.map((row) =>
      this.caseFromRow(
        row,
        sourcesByCaseId.get(row.id) ?? [],
        provenanceByCaseId.get(row.id) ?? [],
      ),
    );
  }

  private record(
    caseId: string,
    kind: "source" | "draft" | "review" | "publish",
    message: string,
    sourceId: string | null = null,
  ): void {
    this.db
      .prepare(
        "INSERT INTO ingestion_provenance (id, case_id, kind, message, source_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(`ingprov_${randomUUID()}`, caseId, kind, message, sourceId, now());
  }

  private addSource(
    caseId: string,
    input: IngestionSourceInput,
  ): IngestionSource {
    const content = input.content ?? null;
    const url = input.url ?? null;
    const source = {
      id: `ingsrc_${randomUUID()}`,
      ...input,
      content,
      url,
      sha256: hash(content),
      createdAt: now(),
    };
    try {
      this.db
        .prepare(
          "INSERT INTO ingestion_sources (id, case_id, kind, label, authority, url, content, content_length, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          source.id,
          caseId,
          source.kind,
          source.label,
          source.authority,
          source.url,
          source.content,
          source.content?.length ?? null,
          source.sha256,
          source.createdAt,
        );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("ingestion_sources_case_sha_idx") ||
        message.includes("ingestion_sources_case_url_idx") ||
        message.includes("UNIQUE constraint failed: ingestion_sources.case_id")
      ) {
        throw new Error(
          "This source is already attached to the ingestion case",
        );
      }
      throw error;
    }
    const row = this.db
      .prepare<
        [string],
        SourceRow
      >("SELECT * FROM ingestion_sources WHERE id = ?")
      .get(source.id);
    if (!row) throw new Error("Could not load the new ingestion source");
    this.record(caseId, "source", `Added ${source.label}`, source.id);
    return this.sourceFromRow(row);
  }

  create(input: {
    projectId: string;
    title: string;
    source: IngestionSourceInput;
  }): IngestionCase {
    const id = `ing_${randomUUID()}`;
    const timestamp = now();
    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO ingestion_cases (id, project_id, title, summary, status, details_json, git_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          id,
          input.projectId,
          input.title,
          "",
          "inbox",
          JSON.stringify(emptyDetails),
          JSON.stringify(defaultGit),
          timestamp,
          timestamp,
        );
      this.addSource(id, input.source);
    })();
    return this.get(id);
  }

  createMeeting(input: {
    projectId: string;
    context: string;
    sources: IngestionSourceInput[];
  }): IngestionCase {
    const id = `ing_${randomUUID()}`;
    const timestamp = now();
    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO ingestion_cases (id, project_id, title, summary, status, details_json, git_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          id,
          input.projectId,
          "New meeting",
          input.context,
          "inbox",
          JSON.stringify(emptyDetails),
          JSON.stringify(defaultGit),
          timestamp,
          timestamp,
        );
      for (const source of input.sources) this.addSource(id, source);
    })();
    return this.get(id);
  }

  update(
    caseId: string,
    input: {
      title?: string;
      summary?: string;
      details?: IngestionDetails;
      status?: "inbox" | "needs_context";
    },
  ): IngestionCase {
    const existing = this.get(caseId);
    if (existing.status === "published")
      throw new Error("Published cases cannot be changed");
    const nextStatus = input.status ?? existing.status;
    if (existing.status === "drafting" && input.status !== undefined)
      throw new Error(
        "Wait for the drafting agent before changing this case status",
      );
    this.db
      .prepare(
        "UPDATE ingestion_cases SET title = ?, summary = ?, status = ?, details_json = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        input.title ?? existing.title,
        input.summary ?? existing.summary,
        nextStatus,
        JSON.stringify(input.details ?? existing.details),
        now(),
        caseId,
      );
    return this.get(caseId);
  }

  appendSource(caseId: string, input: IngestionSourceInput): IngestionCase {
    const existing = this.get(caseId);
    if (!(["inbox", "needs_context"] as string[]).includes(existing.status)) {
      throw new Error("Sources can only be added before drafting starts");
    }
    this.db.transaction(() => {
      this.addSource(caseId, input);
      this.db
        .prepare("UPDATE ingestion_cases SET updated_at = ? WHERE id = ?")
        .run(now(), caseId);
    })();
    return this.get(caseId);
  }

  beginDraft(caseId: string, draftThreadId: string): IngestionCase {
    const existing = this.get(caseId);
    if (
      !(["inbox", "needs_context", "sync_blocked"] as string[]).includes(
        existing.status,
      )
    ) {
      throw new Error(`Cannot draft a case in status ${existing.status}`);
    }
    if (existing.sources.length === 0)
      throw new Error("Add at least one source before drafting");
    this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE ingestion_cases SET status = 'drafting', draft_thread_id = ?, draft_markdown = NULL, outputs_json = NULL, reviewed_at = NULL, updated_at = ? WHERE id = ?",
        )
        .run(draftThreadId, now(), caseId);
      this.record(caseId, "draft", "Started a drafting agent");
    })();
    return this.get(caseId);
  }

  submitDraft(
    caseId: string,
    input: {
      title: string;
      summary: string;
      details: IngestionDetails;
      markdown: string;
      briefing: MeetingBriefing;
      outputs: IngestionOutput[];
      threadId?: string;
    },
  ): IngestionCase {
    const existing = this.get(caseId);
    if (existing.status !== "drafting")
      throw new Error("This case is not drafting");
    if (input.outputs.length === 0)
      throw new Error("A draft requires at least one changed Vault path");
    if (
      input.threadId !== undefined &&
      existing.draft?.draftThreadId !== input.threadId
    ) {
      throw new Error("Only this case's drafting thread can submit its draft");
    }
    this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE ingestion_cases SET title = ?, summary = ?, details_json = ?, status = 'ready', draft_markdown = ?, briefing_json = ?, outputs_json = ?, reviewed_at = ?, updated_at = ? WHERE id = ?",
        )
        .run(
          input.title,
          input.summary,
          JSON.stringify(input.details),
          input.markdown,
          JSON.stringify(input.briefing),
          JSON.stringify(input.outputs),
          now(),
          now(),
          caseId,
        );
      this.record(caseId, "draft", "Draft is ready for review");
    })();
    return this.get(caseId);
  }

  beginRevision(
    caseId: string,
    input: { title: string; details: IngestionDetails },
  ): IngestionCase {
    const existing = this.get(caseId);
    if (
      existing.status !== "ready" ||
      existing.draft?.draftThreadId === null ||
      existing.draft?.draftThreadId === undefined
    )
      throw new Error("Only a ready meeting can accept corrections");
    this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE ingestion_cases SET title = ?, details_json = ?, status = 'drafting', reviewed_at = NULL, updated_at = ? WHERE id = ?",
        )
        .run(input.title, JSON.stringify(input.details), now(), caseId);
      this.record(caseId, "review", "Submitted briefing corrections");
    })();
    return this.get(caseId);
  }

  markPublished(caseId: string, git: GitParity): IngestionCase {
    const existing = this.get(caseId);
    if (existing.status !== "publishing" || existing.draft === null)
      throw new Error("Only publishing cases can complete publication");
    this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE ingestion_cases SET status = 'published', git_json = ?, updated_at = ? WHERE id = ?",
        )
        .run(JSON.stringify(git), now(), caseId);
      this.record(
        caseId,
        "publish",
        `Published ${git.publishedCommit ?? "approved Vault changes"}`,
      );
    })();
    return this.get(caseId);
  }

  markGitBlocked(caseId: string, message: string): IngestionCase {
    const existing = this.get(caseId);
    this.db
      .prepare(
        "UPDATE ingestion_cases SET status = 'sync_blocked', git_json = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        JSON.stringify({ ...existing.git, state: "blocked", message }),
        now(),
        caseId,
      );
    return this.get(caseId);
  }

  markPublishing(caseId: string, preserveLocalChanges: boolean): IngestionCase {
    const existing = this.get(caseId);
    const retryingBlockedCase =
      existing.status === "sync_blocked" && preserveLocalChanges;
    if (
      (existing.status !== "ready" && !retryingBlockedCase) ||
      existing.draft === null
    ) {
      throw new Error("Only ready cases can publish");
    }
    this.db
      .prepare(
        "UPDATE ingestion_cases SET status = 'publishing', updated_at = ? WHERE id = ?",
      )
      .run(now(), caseId);
    return this.get(caseId);
  }
}
