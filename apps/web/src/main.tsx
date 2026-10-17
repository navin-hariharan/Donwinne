import React from "react";
import { createRoot } from "react-dom/client";
import { App, useStore } from "@pns/editor";
import "@pns/editor/src/styles.css";
import { registerServiceWorker } from "./registerServiceWorker";

// structuredClone arrived in Safari 15.4 and Firefox 94. Nets are plain JSON, which is all the
// model code clones, so older browsers get a JSON copy.
if (typeof globalThis.structuredClone !== "function") {
  (globalThis as unknown as { structuredClone: <T>(v: T) => T }).structuredClone = <T,>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
}

const env = (import.meta as unknown as { env: { DEV: boolean; MODE: string } }).env;

// Handy for end-to-end tests and debugging in development builds (the dev server, or `vite build --mode development`).
if (env.DEV || env.MODE === "development") (window as unknown as { pns: typeof useStore }).pns = useStore;

if (!env.DEV) registerServiceWorker();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
