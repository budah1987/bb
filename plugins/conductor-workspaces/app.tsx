import { definePluginApp } from "@bb/plugin-sdk/app";
import {
  ConductorContextBar,
  ConductorNewThreadContextBar,
} from "./src/ConductorContextBar";
import { ConductorSidebar } from "./src/ConductorSidebar";
import "./src/conductor.css";

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: "conductor",
    title: "BBamir",
    description:
      "Repositories, isolated workspaces, and shared conversation tabs.",
    component: ConductorSidebar,
    experimental_contextBar: ConductorContextBar,
    experimental_newThreadContextBar: ConductorNewThreadContextBar,
  });
});
