import { eq } from "drizzle-orm";
import type { PermissionMode, ReasoningLevel, ServiceTier } from "@bb/domain";
import type { DbConnection } from "../connection.js";
import { projectManagerSettings } from "../schema.js";

export interface StoredProjectManagerSettings {
  enabled: boolean;
  providerId: string;
  model: string;
  reasoningLevel: ReasoningLevel;
  serviceTier: ServiceTier;
  permissionMode: PermissionMode;
}

export interface UpsertProjectManagerSettingsArgs
  extends StoredProjectManagerSettings {
  projectId: string;
  updatedAt?: number;
}

export function getProjectManagerSettings(
  db: DbConnection,
  projectId: string,
): StoredProjectManagerSettings | null {
  return (
    db
      .select({
        enabled: projectManagerSettings.enabled,
        providerId: projectManagerSettings.providerId,
        model: projectManagerSettings.model,
        reasoningLevel: projectManagerSettings.reasoningLevel,
        serviceTier: projectManagerSettings.serviceTier,
        permissionMode: projectManagerSettings.permissionMode,
      })
      .from(projectManagerSettings)
      .where(eq(projectManagerSettings.projectId, projectId))
      .get() ?? null
  );
}

export function upsertProjectManagerSettings(
  db: DbConnection,
  args: UpsertProjectManagerSettingsArgs,
): StoredProjectManagerSettings {
  const updatedAt = args.updatedAt ?? Date.now();
  return db
    .insert(projectManagerSettings)
    .values({ ...args, updatedAt })
    .onConflictDoUpdate({
      target: projectManagerSettings.projectId,
      set: {
        enabled: args.enabled,
        providerId: args.providerId,
        model: args.model,
        reasoningLevel: args.reasoningLevel,
        serviceTier: args.serviceTier,
        permissionMode: args.permissionMode,
        updatedAt,
      },
    })
    .returning({
      enabled: projectManagerSettings.enabled,
      providerId: projectManagerSettings.providerId,
      model: projectManagerSettings.model,
      reasoningLevel: projectManagerSettings.reasoningLevel,
      serviceTier: projectManagerSettings.serviceTier,
      permissionMode: projectManagerSettings.permissionMode,
    })
    .get();
}
