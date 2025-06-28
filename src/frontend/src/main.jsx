import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
createRoot(document.getElementById("root")).render(<App />);

/* --- tell Monaco how to load its workers in vite --- */
self.MonacoEnvironment = {
  getWorker(_, label) {
    // one worker per language family keeps bundle small
    switch (label) {
      case "json":   // fall-through
      case "yaml":   return new Worker(
        new URL("monaco-editor/esm/vs/language/json/json.worker?worker", import.meta.url),
        { type: "module" }
      );
      default:
        return new Worker(
          new URL("monaco-editor/esm/vs/editor/editor.worker?worker", import.meta.url),
          { type: "module" }
        );
    }
  }
};
