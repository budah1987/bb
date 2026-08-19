import { deriveForkVersion, parseSemver } from "./semver.mjs";

const generatedPathPatterns = [
  /^packages\/plugin-sdk\/bundled-types\//u,
  /^packages\/templates\/src\/generated\//u,
];
const versionPaths = new Set([
  "packages/bb-app/package.json",
  "apps/desktop/package.json",
]);

export const WIRE_ADJACENT_PATH_PATTERNS = [
  /^packages\/host-daemon-contract\//u,
  /^packages\/server-contract\//u,
  /^packages\/desktop-contract\//u,
  /^packages\/tunnel-contract\//u,
  /^apps\/host-daemon\/src\/(?:server-client|server-connection|server-connection-support|local-api|local-api-config|protocol-self-update|command-router|command-dispatch|command-dispatch-support|command-discovery|event-sink|event-sink-storage|git-scan-contract|daemon|app)\.ts$/u,
  /^apps\/server\/src\/server\.ts$/u,
  /^apps\/server\/src\/internal\//u,
  /^packages\/scripts\/src\/commands\/request-dev-restart\.ts$/u,
];

function classifyPath(path, versionOnlyPaths) {
  if (generatedPathPatterns.some((pattern) => pattern.test(path))) {
    return "generated";
  }
  if (path.startsWith("packages/db/drizzle/")) {
    return "drizzle";
  }
  if (versionPaths.has(path) && versionOnlyPaths.includes(path)) {
    return "version";
  }

  return "unclassified";
}

function evaluateWaiver({
  currentProtocolVersion,
  existingCompatibilityTests,
  flaggedPaths,
  upstreamSha,
  waivers,
}) {
  if (flaggedPaths.length === 0) {
    return { reason: "No wire-adjacent paths changed.", state: "missing" };
  }

  const waiver = waivers.find((entry) => entry.upstreamSha === upstreamSha);

  if (waiver === undefined) {
    return {
      reason: "No waiver matches the exact upstream SHA.",
      state: "missing",
    };
  }

  const structurallyValid =
    /^[0-9a-f]{40}$/u.test(waiver.upstreamSha) &&
    Array.isArray(waiver.paths) &&
    Array.isArray(waiver.compatibilityTests) &&
    waiver.compatibilityTests.length > 0 &&
    typeof waiver.rationale === "string" &&
    waiver.rationale.trim().length > 0 &&
    typeof waiver.approvedBy === "string" &&
    waiver.approvedBy.trim().length > 0 &&
    /^\d{4}-\d{2}-\d{2}$/u.test(waiver.approvedAt) &&
    waiver.protocolVersion === currentProtocolVersion;
  const coversPaths = flaggedPaths.every((path) => waiver.paths.includes(path));
  const testsExist = waiver.compatibilityTests.every((path) =>
    existingCompatibilityTests.includes(path),
  );

  if (!structurallyValid || !coversPaths || !testsExist) {
    return {
      reason:
        "Matching waiver is malformed, does not cover every flagged path, names a missing compatibility test, or targets a different protocol version.",
      state: "invalid",
    };
  }

  return { reason: waiver.rationale, state: "applied" };
}

export function classifyConflicts({
  conflictPaths,
  protocolVersions,
  waivers,
  upstreamSha,
}) {
  const conflicts = conflictPaths.map((path) => {
    const conflictClass = classifyPath(path, protocolVersions.versionOnlyPaths);
    const detail =
      conflictClass === "generated"
        ? "Regenerate after all source conflicts are resolved."
        : conflictClass === "drizzle"
          ? (protocolVersions.drizzleDetails[path] ??
            "Drizzle migration conflict requires manual reconciliation.")
          : conflictClass === "version"
            ? "Package conflict changes only the version field; use --fork-version."
            : "No mechanical resolver is defined for this path.";

    return { class: conflictClass, detail, path };
  });
  const summary = {
    generated: 0,
    drizzle: 0,
    version: 0,
    protocol: 0,
    unclassified: 0,
  };

  for (const conflict of conflicts) {
    summary[conflict.class] += 1;
  }
  summary.protocol = protocolVersions.flaggedPaths.length;

  const protocolVersionAdvanced =
    protocolVersions.upstreamProtocolVersion >
    protocolVersions.currentProtocolVersion;
  const waiver = evaluateWaiver({
    currentProtocolVersion: protocolVersions.currentProtocolVersion,
    existingCompatibilityTests: protocolVersions.existingCompatibilityTests,
    flaggedPaths: protocolVersions.flaggedPaths,
    upstreamSha,
    waivers,
  });
  const protocolReviewRequired =
    protocolVersions.flaggedPaths.length > 0 &&
    !protocolVersionAdvanced &&
    waiver.state !== "applied";
  const conflictReviewRequired = conflicts.some(
    (conflict) =>
      conflict.class === "drizzle" || conflict.class === "unclassified",
  );
  const decision =
    protocolReviewRequired || conflictReviewRequired
      ? "review-required"
      : conflicts.length === 0
        ? "clean"
        : "mechanical";

  return {
    conflicts,
    decision,
    protocol: {
      currentProtocolVersion: protocolVersions.currentProtocolVersion,
      flagged: protocolVersions.flaggedPaths.length > 0,
      protocolVersionAdvanced,
      touchedPaths: protocolVersions.flaggedPaths,
      upstreamProtocolVersion: protocolVersions.upstreamProtocolVersion,
      waiver,
    },
    summary,
  };
}

export function deriveAuditVersionFields({ currentVersions, upstreamVersion }) {
  const parsed = parseSemver(upstreamVersion);

  if (parsed === null) {
    throw new Error(`Invalid upstream package version: ${upstreamVersion}`);
  }

  const upstreamCore = `${parsed.major}.${parsed.minor}.${parsed.patch}`;

  return {
    currentVersion: currentVersions[0],
    proposedVersion: deriveForkVersion({ currentVersions, upstreamCore }),
    upstreamCore,
  };
}

export function isWireAdjacentPath(path) {
  return WIRE_ADJACENT_PATH_PATTERNS.some((pattern) => pattern.test(path));
}
