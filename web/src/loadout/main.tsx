import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LoadoutApp } from "./LoadoutApp.js";
import "../styles/theme.css";
// loadout.css is NOT imported here. LoadoutApp already pulls it in, along with
// the layout and detail layers that build on it — re-importing it after that
// component put it LAST in the emitted stylesheet, so every rule the detail
// layer overrides was being overridden straight back.

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root element not found - check web/loadout.html");
}

createRoot(container).render(
  <StrictMode>
    <LoadoutApp />
  </StrictMode>,
);
