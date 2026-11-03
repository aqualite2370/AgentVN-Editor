import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/variables.css";
import "./styles/layout.css";
import "./styles/editor-tokens.css";
import "../../shared/ui/slowFocusGlow.css";
import { CustomComponentLibraryPanel } from "./components/advanced/CustomComponentLibraryPanel";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode><CustomComponentLibraryPanel /></React.StrictMode>,
);
