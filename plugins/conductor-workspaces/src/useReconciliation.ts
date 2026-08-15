import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { conductorRpcContract } from "./rpc-contract";
import type { ConductorBackfillReport, LegacyWorkspace } from "./projection";

export function useReconciliation() {
  const rpc = useRpc<typeof conductorRpcContract>();
  const [legacyWorkspaces, setLegacyWorkspaces] = useState<
    readonly LegacyWorkspace[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const latestRequest = useRef(0);
  const recordedSignature = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const request = ++latestRequest.current;
    try {
      const result = await rpc.call("readReconciliation", {});
      if (request !== latestRequest.current) return;
      setLegacyWorkspaces(result.legacyWorkspaces);
      recordedSignature.current = result.recordedSignature;
    } finally {
      if (request === latestRequest.current) setIsLoading(false);
    }
  }, [rpc]);

  useEffect(() => {
    void refresh().catch(() => setIsLoading(false));
  }, [refresh]);
  useRealtime("projection-reconciled", () => {
    void refresh().catch(() => undefined);
  });

  const record = useCallback(
    async (report: ConductorBackfillReport) => {
      if (recordedSignature.current === report.signature) return;
      const result = await rpc.call("recordReconciliation", report);
      recordedSignature.current = report.signature;
      if (result.recorded) await refresh();
    },
    [refresh, rpc],
  );

  return { isLoading, legacyWorkspaces, record };
}
