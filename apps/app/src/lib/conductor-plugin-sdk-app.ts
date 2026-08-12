/**
 * Direct host bindings for the app-bundled Conductor presentation.
 *
 * External plugin bundles use a runtime shim for this module. Conductor runs
 * inside the host bundle, so it must bind to the implementation directly.
 */
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
  useRpc,
  useSettings,
} = pluginSdkAppImplementation;

export type * from "@bb/plugin-sdk";
