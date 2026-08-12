import { lazy } from "react";
import type {
  PluginNavPanelSlot,
  PluginThreadListSlot,
} from "@/lib/plugin-slots";
import "bb-plugin-conductor-workspaces/conductor.css";

const loadConductor = () => import("bb-plugin-conductor-workspaces/core");

const ConductorSidebar = lazy(() =>
  loadConductor().then(({ ConductorSidebar: component }) => ({
    default: component,
  })),
);
const ConductorContextBar = lazy(() =>
  loadConductor().then(({ ConductorContextBar: component }) => ({
    default: component,
  })),
);
const ConductorNewThreadContextBar = lazy(() =>
  loadConductor().then(({ ConductorNewThreadContextBar: component }) => ({
    default: component,
  })),
);
const ConductorNewThreadEmptyState = lazy(() =>
  loadConductor().then(({ ConductorNewThreadEmptyState: component }) => ({
    default: component,
  })),
);
const RepositoryDetailsPane = lazy(() =>
  loadConductor().then(({ RepositoryDetailsPane: component }) => ({
    default: component,
  })),
);

export const CONDUCTOR_THREAD_LIST_PROVIDER_KEY =
  "conductor-workspaces/conductor";
export const CONDUCTOR_REPOSITORY_DETAILS_PANEL_KEY =
  "conductor-workspaces/repository-details";

/**
 * Host-bundled Conductor presentation. The plugin id keeps existing RPC and
 * navigation context working while its server responsibilities move into BB.
 */
export const conductorThreadListProvider: PluginThreadListSlot = {
  pluginId: "conductor-workspaces",
  generation: 0,
  id: "conductor",
  title: "BBamir",
  description: "Repositories, isolated workspaces, and conversation tabs.",
  component: ConductorSidebar,
  experimental_contextBar: ConductorContextBar,
  experimental_newThreadContextBar: ConductorNewThreadContextBar,
  experimental_newThreadEmptyState: ConductorNewThreadEmptyState,
};

export const conductorRepositoryDetailsPanel: PluginNavPanelSlot = {
  pluginId: "conductor-workspaces",
  generation: 0,
  id: "repository-details",
  title: "Repository Details",
  icon: "GitBranch",
  path: "repository-details",
  component: RepositoryDetailsPane,
};
