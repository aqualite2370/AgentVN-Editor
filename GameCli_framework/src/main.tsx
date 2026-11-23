import "./utils/runtimeCompatibility";
import React from "react";
import ReactDOM from "react-dom/client";
import "../../shared/ui/nativeInteractionGuards.css";
import "./styles/variables.css";
import "./styles/player.css";
import "./styles/shell.css";
import "./styles/mobile.css";
import "./styles/quick-menu-contract.css";
import "./styles/renpy-button-roles.css";
import { App } from "./app/App";
import { QuickMenuPrototype } from "./prototypes/QuickMenuPrototype";
import "../../shared/ui/slowFocusGlow.css";
import { installGlobalErrorLogging } from "../../shared/logging/frontendErrorLogger";

installGlobalErrorLogging("player", async (source, message) => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("append_frontend_error", { source, message });
});

const isQuickMenuPrototype = new URLSearchParams(window.location.search).get("prototype") === "quick-menu";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isQuickMenuPrototype ? <QuickMenuPrototype /> : <App />}
  </React.StrictMode>
);
