import type { RefObject } from "react";
import { RenameDialog, RenameDialogContent } from "./RenameDialog";

const NAME_MAX_LENGTH = 80;

const NAME_LENGTH_RULES = {
  environment: {
    limit: NAME_MAX_LENGTH,
    message: `Environment name must be ${NAME_MAX_LENGTH} characters or fewer.`,
  },
  workspace: {
    limit: NAME_MAX_LENGTH,
    message: `Workspace name must be ${NAME_MAX_LENGTH} characters or fewer.`,
  },
} as const;

export interface EnvironmentRenameDialogTarget {
  branchName?: string;
  canClearName: boolean;
  id: string;
  currentName: string;
}

interface EnvironmentRenameDialogProps {
  entityLabel?: "environment" | "workspace";
  errorMessage?: string | null;
  target: EnvironmentRenameDialogTarget | null;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: (environmentId: string, name: string | null) => void;
}

export interface EnvironmentRenameDialogContentProps {
  entityLabel?: "environment" | "workspace";
  target: EnvironmentRenameDialogTarget;
  pending: boolean;
  errorMessage?: string | null;
  onRename: (environmentId: string, name: string | null) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

export function EnvironmentRenameDialog({
  entityLabel = "environment",
  errorMessage,
  target,
  pending = false,
  onOpenChange,
  onRename,
}: EnvironmentRenameDialogProps) {
  return (
    <RenameDialog open={target !== null} onOpenChange={onOpenChange}>
      {(inputRef) =>
        target ? (
          <EnvironmentRenameDialogContent
            key={target.id}
            entityLabel={entityLabel}
            target={target}
            pending={pending}
            errorMessage={errorMessage}
            onRename={onRename}
            inputRef={inputRef}
          />
        ) : null
      }
    </RenameDialog>
  );
}

export function EnvironmentRenameDialogContent({
  entityLabel = "environment",
  target,
  pending,
  errorMessage,
  onRename,
  inputRef,
}: EnvironmentRenameDialogContentProps) {
  return (
    <RenameDialogContent
      entityLabel={entityLabel}
      initialName={target.currentName}
      pending={pending}
      errorMessage={errorMessage}
      placeholder={target.branchName ?? `${entityLabel} name`}
      maxLength={NAME_LENGTH_RULES[entityLabel]}
      autoCapitalize="sentences"
      clearAction={
        target.canClearName
          ? {
              label: "Use branch name",
              onClear: () => onRename(target.id, null),
            }
          : undefined
      }
      onRename={(name) => onRename(target.id, name)}
      inputRef={inputRef}
    />
  );
}
