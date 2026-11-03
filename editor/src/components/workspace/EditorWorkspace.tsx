import type { PropsWithChildren, ReactNode } from "react";
import type { WorkspaceController } from "./workspaceContracts";
import { WorkspaceControllerProvider } from "./WorkspaceContext";

export function EditorWorkspace({
  toolbar,
  children,
  drawer,
  statusBar,
  controller,
}: PropsWithChildren<{
  toolbar: ReactNode;
  drawer?: ReactNode;
  statusBar?: ReactNode;
  controller: WorkspaceController;
}>) {
  return (
    <WorkspaceControllerProvider controller={controller}>
      <div className="editor-workspace-shell" data-testid="editor-shell-layout">
        <div className="editor-workspace-toolbar" data-testid="editor-topbar">{toolbar}</div>
        <div className="editor-workspace-body">{children}</div>
        {drawer}
        {statusBar}
      </div>
    </WorkspaceControllerProvider>
  );
}
