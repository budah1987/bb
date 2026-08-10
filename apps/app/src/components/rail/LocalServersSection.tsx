import { useCallback, useMemo, useState } from "react";
import type {
  EnvironmentDockerService,
  TerminalSession,
} from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  useEnvironment,
  useEnvironmentDockerActivity,
  useEnvironmentDockerProvenance,
} from "@/hooks/queries/environment-queries";
import {
  useEnvironmentTerminals,
  useThreadTerminals,
} from "@/hooks/queries/thread-terminal-queries";
import { useThread } from "@/hooks/queries/thread-queries";
import {
  useOpenFixedLocalServersPanel,
  useSetFixedRightTerminalActiveTerminal,
} from "@/lib/fixed-panel-tabs";
import {
  buildLocalServerDisplay,
  isNamedLocalServerTerminal,
  isSharedDockerService,
  resolveDockerServiceOwnerLabel,
  resolveDockerServiceStatus,
  resolveTerminalServerStatus,
  summarizeLocalServers,
  type DockerServiceFreshness,
  type LocalServerDisplay,
  type LocalServerStatus,
} from "@/lib/local-server-status";
import { statusTierClassName } from "@/lib/status-tier";
import { RailRow } from "./RailRow";
import { RailSection } from "./RailSection";
import { RAIL_BODY_TEXT_CLASS } from "./railStyleTokens";

function StatusText({ status }: { status: LocalServerStatus }) {
  return (
    <span className={cn("shrink-0 text-xs", statusTierClassName(status.tier))}>
      {status.label}
      {status.note === null ? null : (
        <span className="sr-only">, {status.note}</span>
      )}
    </span>
  );
}

/**
 * The 12px line under a row, for the one fact the label had no room for. It
 * carries its own action rather than a shared toolbar, so the fix is always
 * next to the thing that needs it.
 */
function RowDetail({
  action,
  isDestructive,
  text,
  title,
}: {
  action: { label: string; onSelect: () => void } | null;
  isDestructive: boolean;
  text: string;
  title: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 px-2 pb-1 pl-8 text-xs text-muted-foreground">
      <span className="min-w-0 flex-1 truncate" title={title}>
        {text}
      </span>
      {action === null ? null : (
        <button
          type="button"
          className={cn(
            "shrink-0 underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            isDestructive && "text-destructive",
          )}
          onClick={action.onSelect}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

function LocalServerRow({
  environmentPath,
  onOpen,
  server,
  status,
}: {
  environmentPath: string | null | undefined;
  onOpen: (terminalId: string) => void;
  server: LocalServerDisplay;
  status: LocalServerStatus;
}) {
  const handleOpen = useCallback(() => onOpen(server.id), [onOpen, server.id]);

  return (
    <div className="min-w-0">
      <RailRow
        icon="Terminal"
        label={server.title}
        onSelect={handleOpen}
        showsChevron
        trailing={<StatusText status={status} />}
      />
      {server.state === "wrong_checkout" ? (
        <RowDetail
          action={{ label: "Open", onSelect: handleOpen }}
          isDestructive
          text={`Started in ${server.initialCwd}`}
          title={`Started in ${server.initialCwd}. Expected ${environmentPath ?? "the thread environment"}.`}
        />
      ) : null}
    </div>
  );
}

function DockerServiceRow({
  freshness,
  onOpen,
  onRecheck,
  service,
  status,
}: {
  freshness: DockerServiceFreshness | null;
  onOpen: () => void;
  onRecheck: () => void;
  service: EnvironmentDockerService;
  status: LocalServerStatus;
}) {
  const isShared = isSharedDockerService(service);
  const needsRecheck =
    service.checkoutStatus === "wrong_checkout" ||
    service.checkoutStatus === "ambiguous" ||
    freshness === "stale" ||
    freshness === "missing_build";
  const ownerLabel = resolveDockerServiceOwnerLabel(service);

  return (
    <div className="min-w-0">
      <RailRow
        icon={isShared ? "Layers" : "PackageReceive"}
        label={service.name}
        onSelect={onOpen}
        showsChevron
        trailing={<StatusText status={status} />}
      />
      {isShared ? (
        <RowDetail
          action={null}
          isDestructive={false}
          text={`Owned by ${ownerLabel}`}
          title={`Owned by ${ownerLabel}`}
        />
      ) : needsRecheck ? (
        <RowDetail
          action={{ label: "Recheck", onSelect: onRecheck }}
          isDestructive={
            service.checkoutStatus === "wrong_checkout" ||
            freshness === "missing_build"
          }
          text={
            freshness === "stale"
              ? "Built before source"
              : freshness === "missing_build"
                ? "Build output missing"
                : `Mounted from ${ownerLabel}`
          }
          title={
            freshness === "stale"
              ? "The newest source file is newer than the newest build file."
              : freshness === "missing_build"
                ? "Source files exist, but the mounted build has no files."
                : service.mounts.map((mount) => mount.source).join("\n")
          }
        />
      ) : null}
    </div>
  );
}

export interface LocalServersSectionProps {
  enabled?: boolean;
  threadId: string;
}

/**
 * Live server processes for the thread and its environment. Terminals named
 * "Terminal" or after a shell stay out of this list; agents already give
 * long-running commands descriptive titles, while generic interactive shells
 * would make the server count noisy and misleading.
 *
 * Build freshness is a filesystem scan, so it is only requested while the
 * section is open. Until it answers, a running container reads as a muted
 * "Running" rather than a green one — the rail never claims a build is current
 * on the strength of the container being up.
 */
export function LocalServersSection({
  enabled = true,
  threadId,
}: LocalServersSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const threadQuery = useThread(threadId, { enabled });
  const environmentId = threadQuery.data?.environmentId;
  const environmentQuery = useEnvironment(environmentId, { enabled });
  const dockerProvenanceQuery = useEnvironmentDockerProvenance(environmentId, {
    enabled,
  });
  const dockerActivityQuery = useEnvironmentDockerActivity(environmentId, {
    enabled: enabled && isExpanded,
  });
  const threadTerminalsQuery = useThreadTerminals(threadId, { enabled });
  const environmentTerminalsQuery = useEnvironmentTerminals(
    environmentId ?? "",
    { enabled },
  );
  const openTerminal = useSetFixedRightTerminalActiveTerminal(
    threadId,
    threadId,
  );
  const openLocalServersPanel = useOpenFixedLocalServersPanel(
    threadId,
    threadId,
  );

  const servers = useMemo(() => {
    const sessionsById = new Map<string, TerminalSession>();
    for (const session of threadTerminalsQuery.data?.sessions ?? []) {
      sessionsById.set(session.id, session);
    }
    for (const session of environmentTerminalsQuery.data?.sessions ?? []) {
      sessionsById.set(session.id, session);
    }
    return Array.from(sessionsById.values())
      .filter(isNamedLocalServerTerminal)
      .map((session) =>
        buildLocalServerDisplay(session, environmentQuery.data?.path),
      )
      .sort((left, right) => left.title.localeCompare(right.title));
  }, [
    environmentQuery.data?.path,
    environmentTerminalsQuery.data?.sessions,
    threadTerminalsQuery.data?.sessions,
  ]);

  const services =
    dockerProvenanceQuery.data?.outcome === "available"
      ? dockerProvenanceQuery.data.services
      : [];

  const freshnessByServiceId = useMemo(() => {
    const byServiceId = new Map<string, DockerServiceFreshness>();
    if (dockerActivityQuery.data?.outcome === "available") {
      for (const activity of dockerActivityQuery.data.activities) {
        byServiceId.set(activity.serviceId, activity.freshness);
      }
    }
    return byServiceId;
  }, [dockerActivityQuery.data]);

  const serverRows = servers.map((server) => ({
    server,
    status: resolveTerminalServerStatus(server.state),
  }));
  const serviceRows = services.map((service) => ({
    freshness: freshnessByServiceId.get(service.id) ?? null,
    service,
    status: resolveDockerServiceStatus({
      freshness: freshnessByServiceId.get(service.id) ?? null,
      service,
    }),
  }));

  const isLoading =
    threadQuery.isLoading ||
    environmentQuery.isLoading ||
    dockerProvenanceQuery.isLoading ||
    threadTerminalsQuery.isLoading ||
    environmentTerminalsQuery.isLoading;
  const hasError =
    threadQuery.isError ||
    environmentQuery.isError ||
    dockerProvenanceQuery.isError ||
    threadTerminalsQuery.isError ||
    environmentTerminalsQuery.isError;
  const summary = summarizeLocalServers({
    isLoading,
    statuses: [...serverRows, ...serviceRows].map((row) => row.status),
  });

  const retry = useCallback(() => {
    void threadQuery.refetch();
    void environmentQuery.refetch();
    void dockerProvenanceQuery.refetch();
    void threadTerminalsQuery.refetch();
    void environmentTerminalsQuery.refetch();
  }, [
    environmentQuery,
    dockerProvenanceQuery,
    environmentTerminalsQuery,
    threadQuery,
    threadTerminalsQuery,
  ]);
  const recheckDocker = useCallback(() => {
    void dockerProvenanceQuery.refetch();
    void dockerActivityQuery.refetch();
  }, [dockerActivityQuery, dockerProvenanceQuery]);

  return (
    <RailSection
      isExpanded={isExpanded}
      label="Local Servers"
      onToggle={() => setIsExpanded((current) => !current)}
      trailing={
        <span
          className={cn("shrink-0 text-xs", statusTierClassName(summary.tier))}
        >
          {summary.label}
        </span>
      }
    >
      {hasError ? (
        <div
          role="alert"
          className={cn(
            RAIL_BODY_TEXT_CLASS,
            "flex items-center gap-2 py-1 text-destructive",
          )}
        >
          <span className="min-w-0 flex-1">Could not load servers.</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-1.5 text-xs"
            onClick={retry}
          >
            Retry
          </Button>
        </div>
      ) : isLoading ? (
        <p className={cn(RAIL_BODY_TEXT_CLASS, "py-1 text-muted-foreground")}>
          Loading servers…
        </p>
      ) : (
        <div className="flex min-w-0 flex-col">
          {serverRows.map((row) => (
            <LocalServerRow
              key={row.server.id}
              environmentPath={environmentQuery.data?.path}
              onOpen={openTerminal}
              server={row.server}
              status={row.status}
            />
          ))}
          {serviceRows.map((row) => (
            <DockerServiceRow
              key={`docker:${row.service.id}`}
              freshness={row.freshness}
              onOpen={openLocalServersPanel}
              onRecheck={recheckDocker}
              service={row.service}
              status={row.status}
            />
          ))}
          {serverRows.length + serviceRows.length === 0 ? (
            <p
              className={cn(RAIL_BODY_TEXT_CLASS, "py-1 text-muted-foreground")}
            >
              No named server processes.
            </p>
          ) : null}
          {dockerProvenanceQuery.data?.outcome === "unavailable" &&
          dockerProvenanceQuery.data.reason !== "docker_not_installed" ? (
            <div
              role="alert"
              className="flex items-center gap-2 py-1 text-xs text-destructive"
            >
              <span className="min-w-0 flex-1 truncate">
                {dockerProvenanceQuery.data.message}
              </span>
              <button
                type="button"
                className="shrink-0 underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={recheckDocker}
              >
                Retry
              </button>
            </div>
          ) : null}
        </div>
      )}
    </RailSection>
  );
}
