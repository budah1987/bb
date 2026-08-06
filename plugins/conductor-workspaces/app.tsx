import { definePluginApp } from "@bb/plugin-sdk/app";
import { ConductorContextBar } from "./src/ConductorContextBar";
import { ConductorSidebar } from "./src/ConductorSidebar";
import "./src/conductor.css";

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: "conductor",
    title: "Conductor",
    description:
      "Repositories, isolated workspaces, and shared conversation tabs.",
    component: ConductorSidebar,
    experimental_contextBar: ConductorContextBar,
  });
});
