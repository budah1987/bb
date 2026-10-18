import { useId, useState } from "react";
import { PROJECT_SCRIPT_APP_COMMAND_IDS } from "@bb/domain";
import {
  t3ProjectScriptsSchema,
  type ProjectScript,
  type ProjectScriptInput,
} from "@bb/server-contract";
import { Icon } from "@bb/shared-ui/icon";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import { Textarea } from "@bb/shared-ui/textarea";
import { useAppCommandShortcuts } from "@/components/commands/AppCommandProvider";
import { sdk } from "@/lib/sdk";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import type { ProjectScriptsController } from "./useProjectScripts";

const ROW_CLASS =
  "flex h-8 min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium text-foreground/80 hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export function ProjectScriptsSection({
  controller,
  projectId,
  environmentId,
  onNavigate,
}: {
  controller: ProjectScriptsController;
  projectId: string;
  environmentId: string | null;
  onNavigate: () => void;
}) {
  const [editing, setEditing] = useState<ProjectScript | "new" | null>(null);
  const [preview, setPreview] = useState<
    Pick<ProjectScriptInput, "name" | "command">[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const shortcuts = useAppCommandShortcuts(PROJECT_SCRIPT_APP_COMMAND_IDS);
  const showError = (error: unknown) =>
    setError(
      getMutationErrorMessage({
        error,
        fallbackMessage: "Could not save project scripts",
      }),
    );
  const busy =
    controller.save.isPending ||
    controller.remove.isPending ||
    controller.importT3.isPending;
  const loadT3 = async () => {
    if (environmentId === null) return;
    setReading(true);
    setError(null);
    try {
      const file = await sdk.projects.fileContent({
        projectId,
        environmentId,
        path: "t3.json",
      });
      if (file.contentEncoding !== "utf8")
        throw new Error("t3.json must be a UTF-8 JSON file");
      const parsed = t3ProjectScriptsSchema.parse(JSON.parse(file.content));
      setPreview(parsed.scripts);
      setEditing(null);
    } catch (error) {
      setError(
        getMutationErrorMessage({
          error,
          fallbackMessage: "Could not read project scripts from t3.json",
        }),
      );
    } finally {
      setReading(false);
    }
  };
  const edit = (script: ProjectScript | "new") => {
    setEditing(script);
    setPreview(null);
    setDeleting(null);
    setError(null);
  };

  return (
    <section aria-label="Project scripts" className="flex flex-col px-2 py-2">
      {controller.scripts.isLoading ? (
        <p className="px-2.5 text-xs text-muted-foreground">Loading scripts…</p>
      ) : null}
      {controller.scripts.isError ? (
        <button
          type="button"
          className={ROW_CLASS}
          onClick={() => void controller.scripts.refetch()}
        >
          Retry loading scripts
        </button>
      ) : null}
      {(controller.scripts.data?.scripts ?? []).map((script) => {
        const command =
          script.shortcut === null
            ? null
            : PROJECT_SCRIPT_APP_COMMAND_IDS[script.shortcut - 1];
        const shortcut =
          command === undefined || command === null
            ? null
            : shortcuts.get(command);
        return (
          <div key={script.id} className="flex min-w-0 items-center">
            <button
              type="button"
              title={script.command}
              className={`${ROW_CLASS} flex-1`}
              disabled={!controller.canRun}
              onClick={() => controller.launch(script, onNavigate)}
              aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
            >
              <Icon
                name="Play"
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-left">
                {script.name}
              </span>
              {shortcut ? (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {shortcut.label}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              className={`${ROW_CLASS} shrink-0 px-2`}
              aria-label={`Edit ${script.name}`}
              onClick={() => edit(script)}
            >
              <Icon name="Settings" className="size-3.5" aria-hidden />
            </button>
          </div>
        );
      })}
      {editing !== null ? (
        <ScriptEditor
          key={editing === "new" ? "new" : editing.id}
          script={editing === "new" ? null : editing}
          busy={busy}
          onCancel={() => {
            setEditing(null);
            setError(null);
          }}
          onSave={async (input) => {
            setError(null);
            try {
              await controller.save.mutateAsync({
                ...input,
                id: editing === "new" ? null : editing.id,
              });
              setEditing(null);
            } catch (error) {
              showError(error);
            }
          }}
          onDelete={
            editing === "new"
              ? null
              : async () => {
                  if (deleting !== editing.id) {
                    setDeleting(editing.id);
                    return;
                  }
                  setError(null);
                  try {
                    await controller.remove.mutateAsync(editing.id);
                    setEditing(null);
                    setDeleting(null);
                  } catch (error) {
                    showError(error);
                  }
                }
          }
          confirmingDelete={editing !== "new" && deleting === editing.id}
        />
      ) : null}
      {preview !== null ? (
        <div className="space-y-2 px-2.5 py-2">
          <p className="text-xs text-muted-foreground">
            Import names and commands only. These run when you choose Run; T3
            setup and lifecycle options are not imported.
          </p>
          <ul className="m-0 max-h-48 space-y-2 overflow-auto p-0">
            {preview.map((script, index) => (
              <li key={index} className="list-none">
                <p className="text-sm font-medium">{script.name}</p>
                <pre className="whitespace-pre-wrap break-all text-xs text-muted-foreground">
                  {script.command}
                </pre>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => {
                if (preview === null) return;
                setError(null);
                void controller.importT3
                  .mutateAsync(JSON.stringify({ scripts: preview }))
                  .then(() => setPreview(null))
                  .catch(showError);
              }}
            >
              Import {preview.length}{" "}
              {preview.length === 1 ? "script" : "scripts"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setPreview(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {editing === null && preview === null ? (
        <>
          <button
            type="button"
            className={`${ROW_CLASS} w-full`}
            onClick={() => edit("new")}
          >
            <Icon
              name="Plus"
              className="size-4 text-muted-foreground"
              aria-hidden
            />
            Add project script
          </button>
          <button
            type="button"
            className={`${ROW_CLASS} w-full text-muted-foreground`}
            disabled={environmentId === null || reading}
            onClick={() => void loadT3()}
          >
            <Icon name="File" className="size-4" aria-hidden />
            {reading ? "Reading t3.json…" : "Import from t3.json"}
          </button>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="px-2.5 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function ScriptEditor({
  script,
  busy,
  onSave,
  onCancel,
  onDelete,
  confirmingDelete,
}: {
  script: ProjectScript | null;
  busy: boolean;
  onSave: (input: ProjectScriptInput) => Promise<void>;
  onCancel: () => void;
  onDelete: (() => Promise<void>) | null;
  confirmingDelete: boolean;
}) {
  const id = useId();
  const [name, setName] = useState(script?.name ?? "");
  const [command, setCommand] = useState(script?.command ?? "");
  const [shortcut, setShortcut] = useState(script?.shortcut?.toString() ?? "");
  return (
    <form
      className="space-y-2 px-2.5 py-2"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave({
          name,
          command,
          shortcut: shortcut === "" ? null : Number(shortcut),
        });
      }}
    >
      <label
        htmlFor={`${id}-name`}
        className="block text-xs text-muted-foreground"
      >
        Name
      </label>
      <Input
        id={`${id}-name`}
        required
        maxLength={200}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <label
        htmlFor={`${id}-command`}
        className="block text-xs text-muted-foreground"
      >
        Shell command
      </label>
      <Textarea
        id={`${id}-command`}
        required
        maxLength={10000}
        value={command}
        onChange={(event) => setCommand(event.target.value)}
        rows={3}
      />
      <label
        htmlFor={`${id}-shortcut`}
        className="block text-xs text-muted-foreground"
      >
        Shortcut slot
      </label>
      <select
        id={`${id}-shortcut`}
        className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
        value={shortcut}
        onChange={(event) => setShortcut(event.target.value)}
      >
        <option value="">None</option>
        {PROJECT_SCRIPT_APP_COMMAND_IDS.map((_, index) => (
          <option key={index} value={String(index + 1)}>
            {index + 1}
          </option>
        ))}
      </select>
      <div className="flex flex-wrap gap-1">
        <Button
          type="submit"
          size="sm"
          disabled={busy || !name.trim() || !command.trim()}
        >
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </Button>
        {onDelete ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void onDelete()}
          >
            {confirmingDelete ? "Confirm delete" : "Delete"}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
