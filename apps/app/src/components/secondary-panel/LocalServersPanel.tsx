import { useCallback } from "react";
import type {
  EnvironmentDockerService,
  EnvironmentDockerServiceActivity,
} from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  useEnvironmentDockerActivity,
  useEnvironmentDockerProvenance,
} from "@/hooks/queries/environment-queries";
import {
  isSharedDockerService,
  resolveDockerServiceOwnerLabel,
  type DockerServiceFreshness,
} from "@/lib/local-server-status";
import { statusTierClassName, type StatusTier } from "@/lib/status-tier";

interface CheckoutVerdict {
  label: string;
  tier: StatusTier;
}

/**
 * The panel states the verdict in full, where the rail only had room for a
 * word. "Shared" is a fact about ownership, so it never reads as a fault; an
 * unknown or ambiguous answer is reported as unknown rather than assumed good.
 */
function resolveCheckoutVerdict(
  service: EnvironmentDockerService,
): CheckoutVerdict {
  if (service.checkoutStatus === "wrong_checkout") {
    return { label: "Wrong checkout", tier: "destructive" };
  }
  if (isSharedDockerService(service)) {
    return { label: "Shared", tier: "muted" };
  }
  switch (service.checkoutStatus) {
    case "ambiguous":
      return { label: "Mixed checkout", tier: "warning" };
    case "unknown":
      return { label: "Checkout unknown", tier: "muted" };
    case "current_checkout":
      return { label: "Correct checkout", tier: "success" };
    case "declared_shared":
      return { label: "Shared", tier: "muted" };
  }
}

function freshnessLabel(freshness: DockerServiceFreshness | null): string {
  switch (freshness) {
    case "fresh":
      return "Up to date";
    case "stale":
      return "Older than the source";
    case "missing_build":
      return "No build output";
    case "unknown":
    case null:
      return "Unknown";
  }
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate" title={value}>
        {value}
      </dd>
    </>
  );
}

function activityTime(value: number | null): string {
  return value === null ? "None" : new Date(value).toLocaleString();
}

export interface LocalServersPanelProps {
  environmentId: string | null | undefined;
}

export function LocalServersPanel({ environmentId }: LocalServersPanelProps) {
  const query = useEnvironmentDockerProvenance(environmentId);
  const activityQuery = useEnvironmentDockerActivity(environmentId);
  const recheck = useCallback(() => {
    void query.refetch();
    void activityQuery.refetch();
  }, [activityQuery, query]);

  if (query.isLoading) {
    return (
      <div className="px-4 py-3 text-sm text-muted-foreground">
        Inspecting Docker mounts…
      </div>
    );
  }

  if (query.isError) {
    return (
      <div
        role="alert"
        className="flex items-center gap-3 px-4 py-3 text-sm text-destructive"
      >
        <span className="min-w-0 flex-1">Could not inspect Docker mounts.</span>
        <Button size="sm" variant="outline" onClick={recheck}>
          Retry
        </Button>
      </div>
    );
  }

  const result = query.data;
  if (result === undefined || result.outcome === "unavailable") {
    return (
      <div className="px-4 py-3 text-sm text-muted-foreground">
        {result?.message ?? "Docker provenance is unavailable."}
      </div>
    );
  }

  const activityByServiceId = new Map<
    string,
    EnvironmentDockerServiceActivity
  >();
  if (activityQuery.data?.outcome === "available") {
    for (const activity of activityQuery.data.activities) {
      activityByServiceId.set(activity.serviceId, activity);
    }
  }
  const serviceGroups = [
    {
      title: "Local servers",
      services: result.services.filter((service) => service.kind === "server"),
    },
    {
      title: "Background services",
      services: result.services.filter((service) => service.kind !== "server"),
    },
  ].filter((group) => group.services.length > 0);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
      <div className="mb-4 flex min-w-0 items-end gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">Environment checkout</p>
          <p className="mt-1 truncate text-sm" title={result.environmentPath}>
            {result.environmentPath}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={recheck}>
          Recheck
        </Button>
      </div>

      {result.services.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No running Docker containers use this repository.
        </p>
      ) : (
        <div className="space-y-5">
          {serviceGroups.map((group) => (
            <section key={group.title}>
              <h2 className="mb-1 text-xs font-medium text-muted-foreground">
                {group.title}
              </h2>
              <div className="divide-y divide-border-hairline border-y border-border-hairline">
                {group.services.map((service) => {
                  const verdict = resolveCheckoutVerdict(service);
                  const isShared = isSharedDockerService(service);
                  const activity = activityByServiceId.get(service.id) ?? null;
                  return (
                    <section key={service.id} className="py-3">
                      <div className="flex min-w-0 items-baseline gap-3">
                        <h3 className="min-w-0 flex-1 truncate text-sm font-medium">
                          {service.name}
                        </h3>
                        <span
                          className={cn(
                            "shrink-0 text-xs",
                            statusTierClassName(verdict.tier),
                          )}
                        >
                          {verdict.label}
                        </span>
                      </div>
                      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
                        <DetailRow label="Image" value={service.image} />
                        <DetailRow label="State" value={service.state} />
                        <DetailRow
                          label="Ports"
                          value={
                            service.publishedPorts.length > 0
                              ? service.publishedPorts.join(", ")
                              : "None"
                          }
                        />
                        <DetailRow
                          label="Build"
                          value={freshnessLabel(activity?.freshness ?? null)}
                        />
                        {activity?.source === null ||
                        activity?.source === undefined ? null : (
                          <>
                            <DetailRow
                              label="Source file"
                              value={activity.source.newestFilePath ?? "None"}
                            />
                            <DetailRow
                              label="Source changed"
                              value={activityTime(
                                activity.source.newestFileMtimeMs,
                              )}
                            />
                          </>
                        )}
                        {activity?.build === null ||
                        activity?.build === undefined ? null : (
                          <>
                            <DetailRow
                              label="Build file"
                              value={activity.build.newestFilePath ?? "None"}
                            />
                            <DetailRow
                              label="Build changed"
                              value={activityTime(
                                activity.build.newestFileMtimeMs,
                              )}
                            />
                          </>
                        )}
                        {isShared ||
                        service.checkoutStatus === "wrong_checkout" ? (
                          <DetailRow
                            label="Owner"
                            value={resolveDockerServiceOwnerLabel(service)}
                          />
                        ) : null}
                      </dl>
                      <div className="mt-3 space-y-2">
                        {service.mounts.map((mount) => (
                          <div key={`${mount.source}:${mount.destination}`}>
                            <p className="text-xs text-muted-foreground">
                              {mount.destination}
                            </p>
                            <p
                              className={cn(
                                "mt-0.5 break-all text-xs",
                                // A shared worker mounts another checkout on purpose,
                                // so its sources are stated, not flagged.
                                isShared ||
                                  mount.checkoutRoot === result.environmentPath
                                  ? "text-foreground"
                                  : "text-destructive",
                              )}
                            >
                              {mount.source}
                            </p>
                          </div>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
