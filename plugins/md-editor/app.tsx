import { useEffect, useMemo, useRef, useState } from "react";
import {
  Markdown,
  definePluginApp,
  type PluginFileOpenerProps,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";

function MarkdownEditorHome() {
  return (
    <div className="space-y-2 p-6 text-sm">
      <h1 className="text-base font-medium text-foreground">Markdown Editor</h1>
      <p className="text-muted-foreground">
        Open a Markdown or text file from the file picker or a file link.
        Markdown files have rendered preview and raw source modes; other text
        files open as readable source.
      </p>
    </div>
  );
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 767px)").matches,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  return isMobile;
}

function MarkdownFileOpener({ path, source }: PluginFileOpenerProps) {
  const rpc = useRpc<typeof rpcContract>();
  const isMobile = useIsMobile();
  const sourceKey = useMemo(
    () =>
      [
        source.kind,
        source.threadId,
        source.environmentId,
        source.projectId,
        path,
      ].join("\0"),
    [
      path,
      source.environmentId,
      source.kind,
      source.projectId,
      source.threadId,
    ],
  );
  const openerSource = useMemo(
    () => ({
      kind: source.kind,
      threadId: source.threadId,
      environmentId: source.environmentId,
      projectId: source.projectId,
    }),
    [source.environmentId, source.kind, source.projectId, source.threadId],
  );
  const [file, setFile] = useState<{
    content: string;
    sha256: string;
    filename: string;
    isMarkdown: boolean;
    readOnly: boolean;
  } | null>(null);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"preview" | "raw">("preview");
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setFile(null);
    setDraft("");
    setError(null);
    setMode("preview");
    void rpc
      .call("openFile", { source: openerSource, path })
      .then((opened) => {
        if (!active) return;
        setFile({
          content: opened.content,
          sha256: opened.sha256,
          filename: opened.path.split(/[\\/]/u).at(-1) ?? path,
          isMarkdown: opened.isMarkdown,
          readOnly: opened.readOnly,
        });
        setDraft(opened.content);
        setMode(opened.isMarkdown ? "preview" : "raw");
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    return () => {
      active = false;
    };
  }, [openerSource, path, rpc, sourceKey]);

  useEffect(() => {
    if (mode === "raw" && !isMobile) editorRef.current?.focus();
  }, [isMobile, mode]);

  const isDirty = file !== null && draft !== file.content;
  const save = async () => {
    if (!file || isMobile || file.readOnly || !isDirty || isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      const result = await rpc.call("saveFile", {
        source: openerSource,
        path,
        content: draft,
        expectedSha256: file.sha256,
      });
      if (result.outcome === "conflict") {
        setError(
          "This file changed elsewhere. Reload it before saving your edits.",
        );
        return;
      }
      setFile({ ...file, content: draft, sha256: result.sha256 });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsSaving(false);
    }
  };

  if (!file && !error) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }
  if (error && !file) {
    return <div className="p-6 text-sm text-destructive">{error}</div>;
  }
  if (!file) return null;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-medium text-foreground">
            {file.filename}
          </h1>
          <p className="text-xs text-muted-foreground">
            {file.readOnly
              ? "GitHub snapshot · read-only"
              : isMobile
                ? "Read-only on mobile"
                : `${draft.length.toLocaleString()} characters`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {file.isMarkdown ? (
            <div
              className="flex rounded-md border border-border p-0.5"
              role="tablist"
              aria-label="Markdown view"
            >
              {(["preview", "raw"] as const).map((nextMode) => (
                <button
                  key={nextMode}
                  type="button"
                  role="tab"
                  aria-selected={mode === nextMode}
                  onClick={() => setMode(nextMode)}
                  className="rounded px-2 py-1 text-xs font-medium text-foreground hover:bg-muted aria-selected:bg-muted"
                >
                  {nextMode === "preview" ? "Preview" : "Raw"}
                </button>
              ))}
            </div>
          ) : null}
          {!isMobile && !file.readOnly ? (
            <button
              type="button"
              onClick={() => void save()}
              disabled={!isDirty || isSaving}
              className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
            >
              {isSaving ? "Saving…" : "Save"}
            </button>
          ) : null}
        </div>
      </header>
      {file.readOnly ? (
        <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
          This file was loaded from GitHub because it is not in the current
          workspace. It is available for viewing, but save it from a workspace
          checkout.
        </div>
      ) : null}
      {mode === "preview" && file.isMarkdown ? (
        <div
          className={`min-h-0 min-w-0 flex-1 overflow-auto px-4 py-5 break-words${isMobile ? "" : " cursor-text"}`}
          onDoubleClick={isMobile ? undefined : () => setMode("raw")}
          title={
            isMobile
              ? undefined
              : "Double-click to view the raw Markdown source"
          }
        >
          <Markdown content={draft} className="text-sm" />
        </div>
      ) : isMobile ? (
        <pre className="min-h-0 min-w-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-5 text-foreground">
          {draft}
        </pre>
      ) : (
        <textarea
          ref={editorRef}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (
              (event.metaKey || event.ctrlKey) &&
              event.key.toLowerCase() === "s"
            ) {
              event.preventDefault();
              void save();
            }
          }}
          aria-label={file.filename}
          spellCheck={false}
          wrap="soft"
          className="min-h-0 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent p-4 font-mono text-xs leading-5 text-foreground outline-none"
        />
      )}
      {error ? (
        <div className="border-t border-border px-4 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "editor",
    title: "Markdown Editor",
    icon: "FileText",
    path: "editor",
    component: MarkdownEditorHome,
  });
  app.slots.fileOpener({
    id: "markdown",
    title: "Markdown Editor",
    extensions: [
      "md",
      "markdown",
      "mdx",
      "txt",
      "text",
      "log",
      "csv",
      "json",
      "yaml",
      "yml",
      "toml",
      "xml",
      "html",
      "css",
      "js",
      "jsx",
      "ts",
      "tsx",
      "sh",
      "bash",
      "zsh",
      "py",
      "rb",
      "go",
      "rs",
      "java",
      "sql",
      "ini",
      "conf",
      "env",
      "properties",
      "diff",
      "patch",
    ],
    component: MarkdownFileOpener,
  });
});
