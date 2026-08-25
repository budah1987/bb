import { spawnSync } from "node:child_process";

function runGit(repoRoot, args, allowedStatuses = [0]) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }
  if (!allowedStatuses.includes(result.status)) {
    throw new Error(
      `git ${args.join(" ")} failed (${String(result.status)}): ${result.stderr.trim()}`,
    );
  }

  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

export function createUpstreamMergeGit(repoRoot) {
  return {
    aheadBehind(headSha, upstreamSha) {
      const output = runGit(repoRoot, [
        "rev-list",
        "--left-right",
        "--count",
        `${headSha}...${upstreamSha}`,
      ]).stdout.trim();
      const [ahead, behind] = output.split(/\s+/u).map(Number);

      return { ahead, behind };
    },

    changedPaths(fromSha, toSha) {
      return runGit(repoRoot, ["diff", "--name-only", "-z", fromSha, toSha])
        .stdout.split("\0")
        .filter(Boolean);
    },

    fetch(remote, upstreamRef) {
      runGit(repoRoot, ["fetch", "--no-tags", remote, upstreamRef]);

      return this.resolve("FETCH_HEAD");
    },

    mergeBase(headSha, upstreamSha) {
      return runGit(repoRoot, [
        "merge-base",
        headSha,
        upstreamSha,
      ]).stdout.trim();
    },

    mergeTree(headSha, upstreamSha) {
      const result = runGit(
        repoRoot,
        ["merge-tree", "--write-tree", "--name-only", headSha, upstreamSha],
        [0, 1],
      );
      const lines = result.stdout.split("\n");
      const treeSha = lines.shift()?.trim() ?? "";
      const conflictPaths = [];

      for (const line of lines) {
        if (line.length === 0) {
          break;
        }
        conflictPaths.push(line);
      }

      return {
        conflictPaths,
        mergedTreeSha: result.status === 0 ? treeSha : null,
      };
    },

    readFileAt(ref, path) {
      const result = runGit(repoRoot, ["show", `${ref}:${path}`], [0, 128]);

      return result.status === 0 ? result.stdout : null;
    },

    resolve(ref) {
      return runGit(repoRoot, [
        "rev-parse",
        "--verify",
        `${ref}^{commit}`,
      ]).stdout.trim();
    },
  };
}
