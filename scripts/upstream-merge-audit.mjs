#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyConflicts,
  deriveAuditVersionFields,
  isWireAdjacentPath,
} from "./lib/upstream-merge-classify.mjs";
import { createUpstreamMergeGit } from "./lib/upstream-merge-git.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = resolve(dirname(scriptPath), "..");
const protocolPath = "packages/host-daemon-contract/src/commands.ts";
const packageVersionPaths = [
  "packages/bb-app/package.json",
  "apps/desktop/package.json",
];
const usage =
  "Usage: node scripts/upstream-merge-audit.mjs --upstream-ref <ref> [--repo-root <path>] [--json <path>] [--markdown <path>] [--remote <name>]";

function parseJson(content, label) {
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function readVersion(content, label) {
  const value = parseJson(content, label);

  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof value.version !== "string"
  ) {
    throw new Error(`Missing string version in ${label}.`);
  }

  return value.version;
}

function readProtocolVersion(content, ref) {
  const match = /HOST_DAEMON_PROTOCOL_VERSION\s*=\s*(\d+)/u.exec(content ?? "");

  if (match === null) {
    throw new Error(`Unable to read HOST_DAEMON_PROTOCOL_VERSION at ${ref}.`);
  }

  return Number(match[1]);
}

function withoutVersion(content, label) {
  const value = parseJson(content, label);

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const { version: _version, ...rest } = value;

  return JSON.stringify(rest);
}

function isVersionOnlyConflict(git, path, refs) {
  const versions = refs.map((ref) => git.readFileAt(ref, path));

  if (versions.some((content) => content === null)) {
    return false;
  }

  const withoutVersions = versions.map((content, index) =>
    withoutVersion(content, `${refs[index]}:${path}`),
  );

  return withoutVersions.every((value) => value === withoutVersions[0]);
}

function describeDrizzleConflict(git, path, refs) {
  if (path !== "packages/db/drizzle/meta/_journal.json") {
    return `Drizzle migration path ${path} conflicted; no automatic fixer is permitted.`;
  }

  const journals = refs.map((ref) => {
    const content = git.readFileAt(ref, path);

    return content === null ? null : parseJson(content, `${ref}:${path}`);
  });
  const [base, ours, theirs] = journals;

  if (
    base === null ||
    ours === null ||
    theirs === null ||
    !Array.isArray(base.entries) ||
    !Array.isArray(ours.entries) ||
    !Array.isArray(theirs.entries)
  ) {
    return "Drizzle journal conflicted and its entry arrays could not be compared.";
  }

  const baseKeys = new Set(
    base.entries.map((entry) => `${entry.idx}:${entry.tag}:${entry.when}`),
  );
  const oursAdded = ours.entries.filter(
    (entry) => !baseKeys.has(`${entry.idx}:${entry.tag}:${entry.when}`),
  );
  const theirsAdded = theirs.entries.filter(
    (entry) => !baseKeys.has(`${entry.idx}:${entry.tag}:${entry.when}`),
  );
  const collisions = [];

  for (const oursEntry of oursAdded) {
    for (const theirsEntry of theirsAdded) {
      if (
        oursEntry.idx === theirsEntry.idx ||
        oursEntry.tag === theirsEntry.tag ||
        oursEntry.when === theirsEntry.when
      ) {
        collisions.push(
          `idx ${String(oursEntry.idx)}: ours ${String(oursEntry.tag)}@${String(oursEntry.when)}, upstream ${String(theirsEntry.tag)}@${String(theirsEntry.when)}`,
        );
      }
    }
  }

  return collisions.length > 0
    ? `Journal collision in ${path}: ${collisions.join("; ")}.`
    : `Journal conflict in ${path}; inspect idx, tag, and when ordering manually.`;
}

function readWaivers(repoRoot) {
  const path = resolve(
    repoRoot,
    "scripts/upstream-audit/protocol-waivers.json",
  );
  const value = parseJson(readFileSync(path, "utf8"), path);

  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.waivers)
  ) {
    throw new Error(
      "Protocol waiver file must use schemaVersion 1 and a waivers array.",
    );
  }

  return value.waivers;
}

export function renderAuditMarkdown(report) {
  const lines = [
    "# Upstream merge audit",
    "",
    `Decision: **${report.decision}** (exit ${report.exitCode})`,
    "",
    `- upstream: \`${report.refs.upstreamRef}\` at \`${report.refs.upstreamSha}\``,
    `- fork head: \`${report.refs.headSha}\``,
    `- ahead/behind: ${report.aheadBehind.ahead}/${report.aheadBehind.behind}`,
    `- proposed fork version: \`${report.versionFields.proposedVersion}\``,
    "",
    "## Conflicts",
    "",
  ];

  if (report.conflicts.length === 0) {
    lines.push("No merge conflicts.");
  } else {
    lines.push("| Path | Class | Detail |", "| --- | --- | --- |");
    for (const conflict of report.conflicts) {
      lines.push(
        `| \`${conflict.path}\` | ${conflict.class} | ${conflict.detail.replaceAll("|", "\\|")} |`,
      );
    }
  }

  lines.push(
    "",
    "## Protocol",
    "",
    `Wire-adjacent changes: ${report.protocol.flagged ? "yes" : "no"}. Protocol ${report.protocol.currentProtocolVersion} → ${report.protocol.upstreamProtocolVersion}; advanced: ${report.protocol.protocolVersionAdvanced ? "yes" : "no"}. Waiver: ${report.protocol.waiver.state} (${report.protocol.waiver.reason}).`,
    "",
  );

  return `${lines.join("\n")}\n`;
}

export function runUpstreamMergeAudit({
  repoRoot,
  upstreamRef,
  git = createUpstreamMergeGit(repoRoot),
  log = () => {},
}) {
  const headSha = git.resolve("HEAD");
  const upstreamSha = git.resolve(upstreamRef);
  const mergeBaseSha = git.mergeBase(headSha, upstreamSha);
  const merge = git.mergeTree(headSha, upstreamSha);
  const aheadBehind = git.aheadBehind(headSha, upstreamSha);
  const upstreamChangedPaths = git.changedPaths(mergeBaseSha, upstreamSha);
  const flaggedPaths = [
    ...new Set([...merge.conflictPaths, ...upstreamChangedPaths]),
  ]
    .filter(isWireAdjacentPath)
    .sort();
  const versionOnlyPaths = merge.conflictPaths.filter((path) =>
    packageVersionPaths.includes(path)
      ? isVersionOnlyConflict(git, path, [mergeBaseSha, headSha, upstreamSha])
      : false,
  );
  const drizzleDetails = Object.fromEntries(
    merge.conflictPaths
      .filter((path) => path.startsWith("packages/db/drizzle/"))
      .map((path) => [
        path,
        describeDrizzleConflict(git, path, [
          mergeBaseSha,
          headSha,
          upstreamSha,
        ]),
      ]),
  );
  const waivers = readWaivers(repoRoot);
  const existingCompatibilityTests = waivers
    .flatMap((waiver) =>
      Array.isArray(waiver.compatibilityTests) ? waiver.compatibilityTests : [],
    )
    .filter((path) => existsSync(resolve(repoRoot, path)));
  const currentProtocolVersion = readProtocolVersion(
    git.readFileAt(headSha, protocolPath),
    headSha,
  );
  const upstreamProtocolVersion = readProtocolVersion(
    git.readFileAt(upstreamSha, protocolPath),
    upstreamSha,
  );
  const classification = classifyConflicts({
    conflictPaths: merge.conflictPaths,
    protocolVersions: {
      currentProtocolVersion,
      drizzleDetails,
      existingCompatibilityTests,
      flaggedPaths,
      upstreamProtocolVersion,
      versionOnlyPaths,
    },
    upstreamSha,
    waivers,
  });
  const currentVersions = packageVersionPaths.map((path) =>
    readVersion(git.readFileAt(headSha, path), `${headSha}:${path}`),
  );
  const upstreamVersion = readVersion(
    git.readFileAt(upstreamSha, packageVersionPaths[0]),
    `${upstreamSha}:${packageVersionPaths[0]}`,
  );
  const exitCode = classification.decision === "review-required" ? 2 : 0;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    refs: {
      baseSha: mergeBaseSha,
      headSha,
      upstreamRef,
      upstreamSha,
      mergeBaseSha,
      mergedTreeSha: merge.mergedTreeSha,
    },
    aheadBehind,
    conflicts: classification.conflicts,
    summary: classification.summary,
    protocol: classification.protocol,
    versionFields: deriveAuditVersionFields({
      currentVersions,
      upstreamVersion,
    }),
    decision: classification.decision,
    exitCode,
  };

  log(renderAuditMarkdown(report));

  return report;
}

function parseArguments(args) {
  const options = { repoRoot: defaultRepoRoot };

  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];

    if (
      value === undefined ||
      ![
        "--upstream-ref",
        "--repo-root",
        "--json",
        "--markdown",
        "--remote",
      ].includes(flag)
    ) {
      throw new Error(usage);
    }

    if (flag === "--upstream-ref") options.upstreamRef = value;
    if (flag === "--repo-root") options.repoRoot = resolve(value);
    if (flag === "--json") options.jsonPath = value;
    if (flag === "--markdown") options.markdownPath = value;
    if (flag === "--remote") options.remote = value;
  }

  if (options.upstreamRef === undefined) {
    throw new Error(usage);
  }

  return options;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const git = createUpstreamMergeGit(options.repoRoot);
  const requestedUpstreamRef = options.upstreamRef;
  const resolvedUpstreamRef = options.remote
    ? git.fetch(options.remote, requestedUpstreamRef)
    : requestedUpstreamRef;
  const report = runUpstreamMergeAudit({
    git,
    repoRoot: options.repoRoot,
    upstreamRef: resolvedUpstreamRef,
  });

  report.refs.upstreamRef = requestedUpstreamRef;
  const markdown = renderAuditMarkdown(report);

  if (options.jsonPath) {
    writeFileSync(
      resolve(options.repoRoot, options.jsonPath),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }
  if (options.markdownPath) {
    writeFileSync(resolve(options.repoRoot, options.markdownPath), markdown);
  }
  if (!options.jsonPath && !options.markdownPath) {
    process.stdout.write(markdown);
  }

  process.exitCode = report.exitCode;
}

if (resolve(process.argv[1] ?? "") === scriptPath) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
