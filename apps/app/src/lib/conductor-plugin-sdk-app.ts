/**
 * Direct host bindings for the app-bundled Conductor presentation.
 *
 * External plugin bundles use a runtime shim for this module. Conductor runs
 * inside the host bundle, so it must bind to the implementation directly.
 */
import type {
  PluginRpcClient,
  PluginRpcContract,
} from "@get-bb/plugin-sdk";
import { conductorRpcClient } from "./conductor-core-rpc";
import { pluginSdkAppImplementation } from "./plugin-sdk-app-impl";

export const {
  Markdown,
  ThreadChat,
  experimental_NewThreadComposer,
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreadPullRequest,
  experimental_useSidebarThreadSplit,
  experimental_useSidebarThreads,
  useBbContext,
  useBbNavigate,
  useComposer,
  useComposerView,
  useRealtime,
  useRealtimeConnectionState,
  useSettings,
} = pluginSdkAppImplementation;

/** Core Conductor calls use BB routes, while external plugins keep plugin RPC. */
export function useRpc<
  Contract extends PluginRpcContract = PluginRpcContract,
>(): PluginRpcClient<Contract> {
  return conductorRpcClient as unknown as PluginRpcClient<Contract>;
}

export type * from "@get-bb/plugin-sdk";
