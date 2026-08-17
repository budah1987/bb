import type { GithubAccount } from "@bb/host-daemon-contract";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import {
  RAIL_BODY_TEXT_CLASS,
  RAIL_INTERACTIVE_CLASS,
} from "./railStyleTokens";

export function GithubAccountRailRow({
  accounts,
  disabled,
  isLoading,
  onChange,
  value,
}: {
  accounts: readonly GithubAccount[];
  disabled: boolean;
  isLoading: boolean;
  onChange: (login: string) => void;
  value: string | null;
}) {
  const label = isLoading
    ? "Loading account"
    : value
      ? `@${value}`
      : "No GitHub account";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled || isLoading || accounts.length === 0}
          aria-label="Choose GitHub account"
          className={cn(
            RAIL_INTERACTIVE_CLASS,
            RAIL_BODY_TEXT_CLASS,
            "cursor-pointer text-muted-foreground disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          <Icon
            name={isLoading ? "Spinner" : "UserRound"}
            className={cn("size-4 shrink-0", isLoading && "animate-spin")}
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate">GitHub account</span>
          <span className="max-w-28 truncate text-xs text-foreground">
            {label}
          </span>
          <Icon
            name="ChevronDown"
            className="size-3 shrink-0 opacity-60"
            aria-hidden
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-64"
        mobileTitle="GitHub account"
      >
        <DropdownMenuLabel>Use for this worktree</DropdownMenuLabel>
        {accounts.map((account) => (
          <DropdownMenuItem
            key={`${account.host}:${account.login}`}
            className="min-h-11 gap-2"
            onSelect={() => onChange(account.login)}
          >
            <span className="min-w-0 flex-1 truncate">@{account.login}</span>
            {account.active ? (
              <span className="text-xs text-muted-foreground">CLI default</span>
            ) : null}
            <Icon
              name="Check"
              className={cn(
                "size-4",
                account.login === value ? "opacity-100" : "opacity-0",
              )}
              aria-hidden
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
