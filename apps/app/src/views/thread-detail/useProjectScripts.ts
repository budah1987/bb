import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { projectScriptsQueryKey } from "@/hooks/queries/query-keys";
import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PROJECT_SCRIPT_APP_COMMAND_IDS, type Thread } from "@bb/domain";
import type {
  ProjectScript,
  ProjectScriptInput,
  TerminalSession,
} from "@bb/server-contract";
import { useIndexedAppCommandHandlers } from "@/components/commands/AppCommandProvider";
import { appToast } from "@/components/ui/app-toast";
import { sdk } from "@/lib/sdk";
import { getMutationErrorMessage } from "@/lib/mutation-errors";

export function useProjectScripts({
  thread,
  isFocused,
  onOpenTerminal,
}: {
  thread: Thread | undefined;
  isFocused: boolean;
  onOpenTerminal: (session: TerminalSession) => boolean;
}) {
  const queryClient = useQueryClient();
  const projectId = thread?.projectId ?? "";
  const queryKey = projectScriptsQueryKey(projectId);
  const scripts = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      sdk.projects.experimental_scripts.list({ projectId, signal }),
    enabled: projectId.length > 0 && projectId !== PERSONAL_PROJECT_ID,
    staleTime: 30_000,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const save = useMutation({
    mutationFn: (input: ProjectScriptInput & { id: string | null }) => {
      const { id, ...values } = input;
      return id === null
        ? sdk.projects.experimental_scripts.create({ ...values, projectId })
        : sdk.projects.experimental_scripts.update({
            ...values,
            projectId,
            scriptId: id,
          });
    },
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (scriptId: string) =>
      sdk.projects.experimental_scripts.delete({ projectId, scriptId }),
    onSuccess: refresh,
  });
  const importT3 = useMutation({
    mutationFn: (content: string) =>
      sdk.projects.experimental_scripts.importT3({ projectId, content }),
    onSuccess: refresh,
  });
  const launching = useRef(false);
  const run = useMutation({
    mutationFn: async (script: ProjectScript) => {
      if (!thread?.environmentId)
        throw new Error("Attach a workspace to run a project script");
      return sdk.projects.experimental_scripts.run({
        projectId,
        scriptId: script.id,
        threadId: thread.id,
      });
    },
  });
  const launch = (script: ProjectScript, onStarted?: () => void) => {
    if (launching.current || !thread?.environmentId) return;
    launching.current = true;
    void run
      .mutateAsync(script)
      .then((session) => {
        onOpenTerminal(session);
        onStarted?.();
      })
      .catch((error: unknown) => {
        appToast.error("Failed to run project script", {
          description: getMutationErrorMessage({
            error,
            fallbackMessage: "Try again",
          }),
        });
      })
      .finally(() => {
        launching.current = false;
      });
  };
  const assignedScript = (index: number) =>
    scripts.data?.scripts.find((script) => script.shortcut === index + 1);
  const canRun = Boolean(thread?.environmentId) && !run.isPending;
  useIndexedAppCommandHandlers(
    PROJECT_SCRIPT_APP_COMMAND_IDS,
    (index) => {
      const script = assignedScript(index);
      if (!isFocused || !canRun || !script) return false;
      launch(script);
      return true;
    },
    0,
    isFocused,
    (index) => canRun && assignedScript(index) !== undefined,
  );

  return { scripts, save, remove, importT3, run, launch, canRun };
}

export type ProjectScriptsController = ReturnType<typeof useProjectScripts>;
