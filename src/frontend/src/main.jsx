import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(<App />);

/* ── tell Monaco how to load its workers in Vite ──────────────────
   – the “.js” extension is REQUIRED for Rollup to find the files   */
self.MonacoEnvironment = {
  getWorker(_, label) {
    switch (label) {
      /* json / yaml / helm-values all share the JSON worker    */
      case "json":
      case "yaml":
        return new Worker(
          new URL(
            "monaco-editor/esm/vs/language/json/json.worker.js?worker",
            import.meta.url
          ),
          { type: "module" }
        );

      /* every other language uses the generic editor worker    */
      default:
        return new Worker(
          new URL(
            "monaco-editor/esm/vs/editor/editor.worker.js?worker",
            import.meta.url
          ),
          { type: "module" }
        );
    }
  },
};
