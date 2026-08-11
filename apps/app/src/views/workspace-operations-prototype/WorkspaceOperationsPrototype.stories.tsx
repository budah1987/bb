import { WorkspaceOperationsPrototype } from "./WorkspaceOperationsPrototype";

export default {
  title: "prototypes/Workspace Operations",
};

export function RepositoryDetails() {
  return <WorkspaceOperationsPrototype />;
}

export function BrowserFeedback() {
  return (
    <WorkspaceOperationsPrototype
      initialSurface="workspace"
      initialDrafts={12}
    />
  );
}

export function RepositorySettings() {
  return <WorkspaceOperationsPrototype initialDetailTab="settings" />;
}

export function RelatedMemory() {
  return <WorkspaceOperationsPrototype initialDetailTab="memory" />;
}

export function Compact() {
  return (
    <div className="flex min-h-screen justify-center bg-surface-recessed">
      <WorkspaceOperationsPrototype
        compact
        initialSurface="workspace"
        initialDrafts={3}
      />
    </div>
  );
}
