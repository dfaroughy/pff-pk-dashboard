import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/space-grotesk";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "../app/globals.css";
import { Dashboard } from "../app/components/Dashboard";

const root = document.getElementById("root");

if (!root) throw new Error("Missing dashboard root element");

createRoot(root).render(
  <React.StrictMode>
    <Dashboard />
  </React.StrictMode>,
);
