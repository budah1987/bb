import { definePluginApp } from "@get-bb/plugin-sdk/app";
import {
  ConductorContextBar,
  ConductorNewThreadContextBar,
} from "./src/ConductorContextBar";
import { ConductorNewThreadEmptyState } from "./src/ConductorNewThreadEmptyState";
import { ConductorSidebar } from "./src/ConductorSidebar";
import { RepositoryDetailsPane } from "./src/RepositoryDetailsPane";
import "./src/conductor.css";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "repository-details",
    title: "Repository Details",
    icon: "GitBranch",
    path: "repository-details",
    component: RepositoryDetailsPane,
  });
  app.slots.experimental_threadList({
    id: "conductor",
    title: "BBamir",
    description:
      "Repositories, isolated workspaces, and shared conversation tabs.",
    component: ConductorSidebar,
    experimental_contextBar: ConductorContextBar,
    experimental_newThreadContextBar: ConductorNewThreadContextBar,
    experimental_newThreadEmptyState: ConductorNewThreadEmptyState,
  });
});
