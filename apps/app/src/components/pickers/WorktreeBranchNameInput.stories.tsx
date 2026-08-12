import { useState } from "react";
import { WorktreeBranchNameInput } from "./WorktreeBranchNameInput";
import {
  buildWorktreeBranchName,
  type WorktreeBranchPrefix,
} from "@/lib/worktree-branch-name";

export const Default = () => {
  const [prefix, setPrefix] = useState<WorktreeBranchPrefix>("amir");
  const [slug, setSlug] = useState("");
  const branchName = buildWorktreeBranchName(prefix, slug);

  return (
    <div className="grid min-h-72 place-items-center bg-background p-6 text-foreground">
      <div className="grid gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Worktree branch name
        </span>
        <WorktreeBranchNameInput
          prefix={prefix}
          slug={slug}
          onPrefixChange={setPrefix}
          onSlugChange={setSlug}
        />
        <span className="min-h-4 text-xs text-muted-foreground">
          {branchName ?? "BB will generate an amir/ branch name."}
        </span>
      </div>
    </div>
  );
};

Default.storyName = "Worktree branch name";

export const Mobile = () => {
  const [prefix, setPrefix] = useState<WorktreeBranchPrefix>("amir");
  const [slug, setSlug] = useState("improve-worktree-naming");

  return (
    <div className="min-h-dvh bg-background p-5 text-foreground">
      <div className="grid gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Worktree branch name
        </span>
        <WorktreeBranchNameInput
          prefix={prefix}
          slug={slug}
          onPrefixChange={setPrefix}
          onSlugChange={setSlug}
          layout="mobile"
        />
      </div>
    </div>
  );
};

Mobile.storyName = "Mobile PWA";
