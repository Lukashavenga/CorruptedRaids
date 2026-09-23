import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AdminApp } from "./AdminApp.js";
import { AdminGate } from "./AdminGate.js";
import "../styles/theme.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AdminGate>
      <AdminApp />
    </AdminGate>
  </StrictMode>,
);
