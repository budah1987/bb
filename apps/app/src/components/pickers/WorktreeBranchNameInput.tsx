import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  WORKTREE_BRANCH_PREFIXES,
  formatWorktreeBranchSlug,
  type WorktreeBranchPrefix,
} from "@/lib/worktree-branch-name";

interface WorktreeBranchNameInputProps {
  prefix: WorktreeBranchPrefix;
  slug: string;
  onPrefixChange: (prefix: WorktreeBranchPrefix) => void;
  onSlugChange: (slug: string) => void;
  disabled?: boolean;
  className?: string;
  layout?: "desktop" | "mobile";
}

export function WorktreeBranchNameInput({
  prefix,
  slug,
  onPrefixChange,
  onSlugChange,
  disabled = false,
  className,
  layout = "desktop",
}: WorktreeBranchNameInputProps) {
  const selectedPrefix =
    WORKTREE_BRANCH_PREFIXES.find((option) => option.value === prefix) ??
    WORKTREE_BRANCH_PREFIXES[0];

  return (
    <div
      role="group"
      aria-label="Worktree branch name"
      className={cn(
        "flex max-w-full shrink-0 items-stretch overflow-hidden rounded-md border border-border bg-background focus-within:ring-1 focus-within:ring-ring",
        layout === "mobile" ? "h-11 w-full" : "h-7 w-52",
        disabled && "opacity-50",
        className,
      )}
    >
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            aria-label={`Worktree branch type: ${selectedPrefix.label}`}
            className={cn(
              "h-auto shrink-0 gap-1 rounded-none border-r border-border font-medium",
              layout === "mobile" ? "px-3 text-sm" : "px-2 text-xs",
            )}
          >
            <span>{prefix}/</span>
            <Icon name="ChevronDown" className="size-3" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuLabel>Branch type</DropdownMenuLabel>
          {WORKTREE_BRANCH_PREFIXES.map((option) => (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => onPrefixChange(option.value)}
            >
              <span className="flex-1">{option.label}</span>
              <span className="text-muted-foreground">{option.value}/</span>
              <Icon
                name="Check"
                className={cn(
                  "size-3.5",
                  option.value === prefix ? "opacity-100" : "opacity-0",
                )}
                aria-hidden
              />
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Input
        value={slug}
        onChange={(event) =>
          onSlugChange(formatWorktreeBranchSlug(event.target.value))
        }
        disabled={disabled}
        aria-label="Worktree name"
        placeholder="automatic-name"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={cn(
          "h-auto min-w-20 flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0",
          layout === "mobile" ? "px-3 text-sm" : "px-2 text-xs",
        )}
      />
    </div>
  );
}
