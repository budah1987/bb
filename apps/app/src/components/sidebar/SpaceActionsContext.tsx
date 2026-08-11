import { createContext, useContext, type ReactNode } from "react";
import type { SpaceResponse } from "@bb/server-contract";

interface SpaceActionsContextValue {
  activeSpaceId: string;
  moveProject: (projectId: string, spaceId: string) => void;
  spaces: readonly SpaceResponse[];
}

const SpaceActionsContext = createContext<SpaceActionsContextValue | null>(
  null,
);

export function SpaceActionsProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: SpaceActionsContextValue;
}) {
  return (
    <SpaceActionsContext.Provider value={value}>
      {children}
    </SpaceActionsContext.Provider>
  );
}

export function useSpaceActions(): SpaceActionsContextValue | null {
  return useContext(SpaceActionsContext);
}
