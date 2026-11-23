import { createContext, useContext } from "react";
import type { PropsWithChildren } from "react";
import type { WorkspaceController } from "./workspaceContracts";

const WorkspaceControllerContext = createContext<WorkspaceController | null>(null);

export function WorkspaceControllerProvider({
  controller,
  children,
}: PropsWithChildren<{ controller: WorkspaceController }>) {
  return (
    <WorkspaceControllerContext.Provider value={controller}>
      {children}
    </WorkspaceControllerContext.Provider>
  );
}

export function useWorkspaceController(): WorkspaceController {
  const controller = useContext(WorkspaceControllerContext);
  if (!controller) throw new Error("useWorkspaceController must be used inside EditorWorkspace");
  return controller;
}
