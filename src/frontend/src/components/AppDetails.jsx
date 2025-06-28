/*  AppDetails.jsx
    ───────────────────────────────────────────────
    Popup with:

      • chart description + maintainers / home URL
      • side-by-side Monaco viewers
      • graceful loading spinner
*/

import React, { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import Spinner from "./Spinner.jsx";

export default function AppDetails({ project, file, app, onClose }) {
  /* ── state ─────────────────────────────────────────────── */
  const [vals, setVals] = useState({
    defaultValues  : "",
    overrideValues : "",
    meta           : { description: "", home: "", maintainers: [] },
  });
  const [loading, setLoading] = useState(true);

  /* ── code-editor containers ────────────────────────────── */
  const defRef = useRef(null);
  const ovrRef = useRef(null);

  /* ── fetch YAML + metadata once ────────────────────────── */
  useEffect(() => {
    const { name, chart, targetRevision: version, repoURL, path: chartPath } =
      app;

    const qs = new URLSearchParams({
      project,
      name,
      chart,
      version,
      repoURL,
      path: chartPath,
      file,
    });

    fetch(`/api/app/values?${qs.toString()}`)
      .then((r) => r.json())
      .then((json) => {
        setVals(json);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [project, file, app]);

  /* ── mount readonly Monaco viewers when data ready ─────── */
  useEffect(() => {
    if (loading || !defRef.current) return;

    const shared = {
      language: "yaml",
      readOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
    };

    const defEd = monaco.editor.create(defRef.current, {
      value: vals.defaultValues || "# (no file)",
      ...shared,
    });
    const ovrEd = monaco.editor.create(ovrRef.current, {
      value: vals.overrideValues || "# (no override)",
      ...shared,
    });

    return () => {
      defEd.dispose();
      ovrEd.dispose();
    };
  }, [loading, vals]);

  /* ── helpers ────────────────────────────────────────────── */
  const Meta = () => {
    const { description, home, maintainers } = vals.meta;
    if (!description && !home && !maintainers.length) return null;

    return (
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "0.9rem 1rem",
          marginBottom: "1rem",
          background: "var(--card-bg)",
          color: "var(--text-light)",
        }}
      >
        {description && <p style={{ margin: 0 }}>{description}</p>}

        {(home || maintainers.length) && (
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.85rem" }}>
            {home && (
              <>
                <strong>Home:</strong>{" "}
                <a href={home} target="_blank" rel="noopener noreferrer">
                  {home}
                </a>
                {maintainers.length ? " · " : ""}
              </>
            )}
            {maintainers.length > 0 && (
              <>
                <strong>Maintainers:</strong>{" "}
                {maintainers.join(", ")}
              </>
            )}
          </p>
        )}
      </div>
    );
  };

  /* ── render ─────────────────────────────────────────────── */
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-dialog"
        style={{ width: "90vw", maxWidth: 1280 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="close">
          ×
        </button>

        <h2 style={{ marginTop: 0, marginBottom: "0.6rem" }}>
          {app.name}
          {" – "}
          <em>{project}</em>
        </h2>

        <p style={{ margin: 0 }}>
          <strong>{app.chart}</strong> @ {app.targetRevision}
          {app.repoURL && (
            <>
              <br />
              <small>{app.repoURL}</small>
            </>
          )}
        </p>

        {loading ? (
          <div style={{ padding: "2rem", textAlign: "center" }}>
            <Spinner size={32} />
          </div>
        ) : (
          <>
            <Meta />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "1rem",
              }}
            >
              <div>
                <h3 style={{ margin: "0 0 .5rem" }}>Chart defaults</h3>
                <div
                  ref={defRef}
                  style={{
                    height: "48vh",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                  }}
                />
              </div>

              <div>
                <h3 style={{ margin: "0 0 .5rem" }}>Override values</h3>
                <div
                  ref={ovrRef}
                  style={{
                    height: "48vh",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                  }}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
