import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OperatorApp } from "./OperatorApp.js";
import "../styles/theme.css";
import "../loadout/loadout.css";
import "../loadout/loadout-panels.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root element not found - check web/operator.html");
}

createRoot(container).render(
  <StrictMode>
    <OperatorApp />
  </StrictMode>,
);
