import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../App.js";
import { Arena3D } from "./Arena3D.js";
import "../styles/theme.css";

/**
 * The overlay, with the fight in three dimensions.
 *
 * The same App as index.html - same connection, same replay, same banner,
 * roster and bars - handed a different arena. It is its own entry point so
 * that three.js lives in this bundle and nowhere else: the flat overlay does
 * not pay half a megabyte for a renderer it never starts.
 */
const container = document.getElementById("root");
if (!container) {
  throw new Error("#root element not found - check web/arena3d.html");
}

createRoot(container).render(
  <StrictMode>
    <App Arena={Arena3D} />
  </StrictMode>,
);
