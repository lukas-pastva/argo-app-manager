import React, { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";

export default function AppDetails({ project, file, app, onClose }) {
  const [vals, setVals] = useState({ defaultValues: "", overrideValues: "" });
  const defRef = useRef(null), ovrRef = useRef(null);

  useEffect(() => {
    const { name, chart, targetRevision: version, repoURL } = app;
    const qs = new URLSearchParams({
      project, name, chart, version, repoURL, file,
    });
    fetch(`/api/app/values?${qs.toString()}`)
      .then((r) => r.json())
      .then(setVals);
  }, [project, file, app]);

  /* Monaco mount ------------------------------------------------- */
  useEffect(() => {
    if (!defRef.current) return;
    const def = monaco.editor.create(defRef.current, {
      value: vals.defaultValues || "# (no file)",
      language: "yaml",
      readOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
    });
    const ovr = monaco.editor.create(ovrRef.current, {
      value: vals.overrideValues || "# (no override)",
      language: "yaml",
      readOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
    });
    return () => { def.dispose(); ovr.dispose(); };
  }, [vals]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-dialog"
        style={{ width: "90vw", maxWidth: 1200 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="close">
          ×
        </button>

        <h2 style={{ marginTop: 0 }}>
          {app.name} – <em>{project}</em>
        </h2>

        <p>
          <strong>{app.chart}</strong> @ {app.targetRevision}
          <br />
          <small>{app.repoURL}</small>
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <div>
            <h3>Chart default values</h3>
            <div ref={defRef} style={{ height: "45vh", border: "1px solid #ccc" }} />
          </div>
          <div>
            <h3>Override values</h3>
            <div ref={ovrRef} style={{ height: "45vh", border: "1px solid #ccc" }} />
          </div>
        </div>
      </div>
    </div>
  );
}
