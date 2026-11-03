import React from "react";
import ReactDOM from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "../../shared/ui/nativeInteractionGuards.css";
import "./styles/variables.css";
import "./styles/layout.css";
import "./styles/editor-tokens.css";
import "./styles/editor-shell.css";
import "./styles/editor-topbar.css";
import "./styles/editor-responsive.css";
import "./styles/editor-preview.css";
import "./styles/editor-publish.css";
import "./styles/quick-menu-preview.css";
import "./styles/asset-studio.css";
import "./styles/nodes.css";
import { App } from "./app/App";
import "../../shared/ui/slowFocusGlow.css";
import { installGlobalErrorLogging } from "../../shared/logging/frontendErrorLogger";

installGlobalErrorLogging("editor", async (source, message) => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("append_frontend_error", { source, message });
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
