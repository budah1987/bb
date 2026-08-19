import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const auditScriptPath = fileURLToPath(
  new URL("../../../scripts/upstream-merge-audit.mjs", import.meta.url),
);
const testRoots = [];
const gitEnvironment = {
  ...process.env,
  GIT_AUTHOR_DATE: "2026-08-18T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-08-18T00:00:00Z",
};

function write(repoRoot, path, content) {
  const absolutePath = join(repoRoot, path);

  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

function git(repoRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: gitEnvironment,
  });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }

  return result.stdout.trim();
}

function commit(repoRoot, message) {
  git(repoRoot, ["add", "-A"]);
  git(repoRoot, ["commit", "-m", message]);
}

function packageJson(version) {
  return `${JSON.stringify({ name: "fixture", version }, null, 2)}\n`;
}

function journal(entry) {
  return `${JSON.stringify({ version: "7", dialect: "sqlite", entries: [entry] }, null, 2)}\n`;
}

function createFixture({ base, ours, theirs }) {
  const repoRoot = mkdtempSync(join(tmpdir(), "bb-upstream-audit-"));
  const outputRoot = mkdtempSync(join(tmpdir(), "bb-upstream-audit-output-"));
  testRoots.push(repoRoot, outputRoot);
  git(repoRoot, ["init", "-b", "base"]);
  git(repoRoot, ["config", "user.email", "fixture@example.com"]);
  git(repoRoot, ["config", "user.name", "Audit Fixture"]);
  write(
    repoRoot,
    "packages/bb-app/package.json",
    packageJson("0.38.0-bbamir.1"),
  );
  write(repoRoot, "apps/desktop/package.json", packageJson("0.38.0-bbamir.1"));
  write(
    repoRoot,
    "packages/host-daemon-contract/src/commands.ts",
    "export const HOST_DAEMON_PROTOCOL_VERSION = 124 as const;\n",
  );
  write(
    repoRoot,
    "scripts/upstream-audit/protocol-waivers.json",
    '{"schemaVersion":1,"waivers":[]}\n',
  );
  write(repoRoot, "test/protocol.test.ts", "// compatibility fixture\n");
  base?.(repoRoot);
  commit(repoRoot, "base");
  git(repoRoot, ["switch", "-c", "theirs"]);
  theirs(repoRoot);
  commit(repoRoot, "theirs");
  const upstreamSha = git(repoRoot, ["rev-parse", "HEAD"]);
  git(repoRoot, ["switch", "-c", "ours", "base"]);
  ours(repoRoot, upstreamSha);
  commit(repoRoot, "ours");

  return { outputRoot, repoRoot, upstreamSha };
}

function runAudit(fixture) {
  const jsonPath = join(fixture.outputRoot, "audit.json");
  const markdownPath = join(fixture.outputRoot, "audit.md");
  const before = git(fixture.repoRoot, ["status", "--porcelain"]);
  const result = spawnSync(
    process.execPath,
    [
      auditScriptPath,
      "--repo-root",
      fixture.repoRoot,
      "--upstream-ref",
      fixture.upstreamSha,
      "--json",
      jsonPath,
      "--markdown",
      markdownPath,
    ],
    { encoding: "utf8" },
  );
  const after = git(fixture.repoRoot, ["status", "--porcelain"]);

  expect(after).toBe(before);

  return {
    report: JSON.parse(readFileSync(jsonPath, "utf8")),
    result,
  };
}

afterEach(() => {
  for (const testRoot of testRoots.splice(0)) {
    rmSync(testRoot, { force: true, recursive: true });
  }
});

describe("upstream merge audit", () => {
  it("classifies a generated-only conflict as mechanical without changing the worktree", () => {
    const fixture = createFixture({
      base: (root) =>
        write(root, "packages/templates/src/generated/a.ts", "base\n"),
      ours: (root) =>
        write(root, "packages/templates/src/generated/a.ts", "ours\n"),
      theirs: (root) =>
        write(root, "packages/templates/src/generated/a.ts", "theirs\n"),
    });
    const { report, result } = runAudit(fixture);

    expect(result.status).toBe(0);
    expect(report.decision).toBe("mechanical");
    expect(report.summary.generated).toBe(1);
    expect(report.schemaVersion).toBe(1);
  });

  it("fails closed when generated and source files conflict", () => {
    const fixture = createFixture({
      base: (root) => {
        write(root, "packages/plugin-sdk/bundled-types/a.d.ts", "base\n");
        write(root, "apps/server/src/other.ts", "base\n");
      },
      ours: (root) => {
        write(root, "packages/plugin-sdk/bundled-types/a.d.ts", "ours\n");
        write(root, "apps/server/src/other.ts", "ours\n");
      },
      theirs: (root) => {
        write(root, "packages/plugin-sdk/bundled-types/a.d.ts", "theirs\n");
        write(root, "apps/server/src/other.ts", "theirs\n");
      },
    });
    const { report, result } = runAudit(fixture);

    expect(result.status).toBe(2);
    expect(report.decision).toBe("review-required");
    expect(report.summary).toMatchObject({ generated: 1, unclassified: 1 });
  });

  it("reports a Drizzle journal collision without offering a fixer", () => {
    const baseEntry = { idx: 90, tag: "base", when: 1000 };
    const fixture = createFixture({
      base: (root) =>
        write(
          root,
          "packages/db/drizzle/meta/_journal.json",
          journal(baseEntry),
        ),
      ours: (root) =>
        write(
          root,
          "packages/db/drizzle/meta/_journal.json",
          `${JSON.stringify({ version: "7", dialect: "sqlite", entries: [baseEntry, { idx: 91, tag: "ours", when: 2000 }] }, null, 2)}\n`,
        ),
      theirs: (root) =>
        write(
          root,
          "packages/db/drizzle/meta/_journal.json",
          `${JSON.stringify({ version: "7", dialect: "sqlite", entries: [baseEntry, { idx: 91, tag: "theirs", when: 3000 }] }, null, 2)}\n`,
        ),
    });
    const { report, result } = runAudit(fixture);

    expect(result.status).toBe(2);
    expect(report.conflicts[0]).toMatchObject({ class: "drizzle" });
    expect(report.conflicts[0].detail).toContain("idx 91");
    expect(report.conflicts[0].detail).toContain("ours@2000");
    expect(report.conflicts[0].detail).toContain("theirs@3000");
  });

  it("classifies package version-only conflicts as mechanical", () => {
    const fixture = createFixture({
      ours: (root) => {
        write(
          root,
          "packages/bb-app/package.json",
          packageJson("0.38.0-bbamir.2"),
        );
        write(
          root,
          "apps/desktop/package.json",
          packageJson("0.38.0-bbamir.2"),
        );
      },
      theirs: (root) => {
        write(root, "packages/bb-app/package.json", packageJson("0.39.0"));
        write(root, "apps/desktop/package.json", packageJson("0.39.0"));
      },
    });
    const { report, result } = runAudit(fixture);

    expect(result.status).toBe(0);
    expect(report.decision).toBe("mechanical");
    expect(report.summary.version).toBe(2);
    expect(report.versionFields).toEqual({
      currentVersion: "0.38.0-bbamir.2",
      proposedVersion: "0.39.0-bbamir.1",
      upstreamCore: "0.39.0",
    });
  });

  it.each([
    ["without a waiver", false, 2, "review-required", "missing"],
    ["with a valid waiver", true, 0, "clean", "applied"],
  ])(
    "flags a protocol-adjacent upstream change %s",
    (_label, withWaiver, expectedStatus, expectedDecision, waiverState) => {
      const path = "apps/server/src/internal/session.ts";
      const fixture = createFixture({
        base: (root) => write(root, path, "export const value = 'base';\n"),
        ours: (root, upstreamSha) => {
          write(root, "ours.txt", "fork-only\n");
          if (withWaiver) {
            write(
              root,
              "scripts/upstream-audit/protocol-waivers.json",
              `${JSON.stringify(
                {
                  schemaVersion: 1,
                  waivers: [
                    {
                      upstreamSha,
                      paths: [path],
                      rationale: "Fixture proves the change is server-only.",
                      compatibilityTests: ["test/protocol.test.ts"],
                      approvedBy: "fixture@example.com",
                      approvedAt: "2026-08-18",
                      protocolVersion: 124,
                    },
                  ],
                },
                null,
                2,
              )}\n`,
            );
          }
        },
        theirs: (root) =>
          write(root, path, "export const value = 'upstream';\n"),
      });
      const { report, result } = runAudit(fixture);

      expect(result.status).toBe(expectedStatus);
      expect(report.decision).toBe(expectedDecision);
      expect(report.protocol).toMatchObject({
        flagged: true,
        protocolVersionAdvanced: false,
        touchedPaths: [path],
        waiver: { state: waiverState },
      });
    },
  );
});
