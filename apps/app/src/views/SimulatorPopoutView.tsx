import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { SimulatorTabContent } from "@/components/secondary-panel/SimulatorTabContent";

export function SimulatorPopoutView() {
  const { environmentId } = useParams<{ environmentId: string }>();

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "iOS Simulator — bb";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  if (!environmentId) {
    return (
      <main className="flex h-dvh items-center justify-center bg-background px-6 text-center text-sm text-muted-foreground">
        This simulator window has no environment.
      </main>
    );
  }

  return (
    <main className="h-dvh min-h-0 overflow-hidden bg-background">
      <SimulatorTabContent
        environmentId={environmentId}
        isActive
        presentation="popout"
      />
    </main>
  );
}

export default SimulatorPopoutView;
