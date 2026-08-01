import React from "react";
import ReactDOM from "react-dom/client";
import "../../shared/ui/nativeInteractionGuards.css";
import "./styles/variables.css";
import "./styles/player.css";
import "./styles/shell.css";
import "./styles/mobile.css";
import { App } from "./app/App";
import "../../shared/ui/slowFocusGlow.css";
import { installGlobalErrorLogging } from "../../shared/logging/frontendErrorLogger";

installGlobalErrorLogging("player", async (source, message) => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("append_frontend_error", { source, message });
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
