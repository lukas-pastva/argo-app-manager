/*  AppDetails.jsx
    ───────────────────────────────────────────────
    Modal that shows
      • chart default values
      • override values
      • optional meta (description / home / maintainers)
*/

import React, { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import Spinner from "./Spinner.jsx";

/* helper ────────────────────────────────────────────
   returns { chart, version } for *either* source style */
function chartInfo(app) {
  if (app.chart) {
    return { chart: app.chart, version: app.targetRevision || "" };
  }
  const seg = (app.path || "").split("/").filter(Boolean);
  return { chart: seg.at(-2) || "", version: seg.at(-1) || "" };
}

export default function AppDetails({ project, file, app, onClose }) {
  /* ── state ─────────────────────────────────────────────── */
  const [vals, setVals] = useState({
    defaultValues: "",
    overrideValues: "",
    meta: {},               // may be absent
  });
  const [loading, setLoading] = useState(true);

  /* ── refs for the two read-only editors ─────────────────── */
  const defRef = useRef(null);
  const ovrRef = useRef(null);

  /* ── lock body scroll while modal open ──────────────────── */
  useEffect(() => {
    document.body.classList.add("modal-open");
    return () => document.body.classList.remove("modal-open");
  }, []);

  /* ── fetch chart + values once ──────────────────────────── */
  useEffect(() => {
    const { chart, version } = chartInfo(app);
    const qs = new URLSearchParams({
      project,
      name   : app.name,
      chart,
      version,
      repoURL: app.repoURL,
      path   : app.path,
      file,
    });

    fetch(`/api/app/values?${qs.toString()}`)
      .then((r) => r.json())
      .then((j) => {
        setVals({
          defaultValues : j.defaultValues  || "",
          overrideValues: j.overrideValues || "",
          meta          : j.meta           || {},
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [project, file, app]);

  /* ── mount Monaco viewers when data ready ───────────────── */
  useEffect(() => {
    if (loading || !defRef.current) return;

    const common = {
      language: "yaml",
      readOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
    };

    const e1 = monaco.editor.create(defRef.current, {
      value: vals.defaultValues || "# (no values.yaml found)",
      ...common,
    });
    const e2 = monaco.editor.create(ovrRef.current, {
      value: vals.overrideValues || "# (no override file)",
      ...common,
    });

    return () => {
      e1.dispose();
      e2.dispose();
    };
  }, [loading, vals]);

  /* ── tiny component for optional meta box ───────────────── */
  function Meta() {
    const { description = "", home = "", maintainers = [] } = vals.meta ?? {};
    if (!description && !home && maintainers.length === 0) return null;

    return (
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "0.9rem 1rem",
          margin: "1rem 0",
          background: "var(--card-bg)",
          color: "var(--text-light)",
        }}
      >
        {description && <p style={{ margin: 0 }}>{description}</p>}
        {(home || maintainers.length) && (
          <p style={{ margin: ".6rem 0 0", fontSize: ".85rem" }}>
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
                <strong>Maintainers:</strong> {maintainers.join(", ")}
              </>
            )}
          </p>
        )}
      </div>
    );
  }

  /* ── unified close helper ───────────────────────────────── */
  const close = () => {
    document.body.classList.remove("modal-open");
    onClose();
  };

  /* ── render ─────────────────────────────────────────────── */
  const { chart, version } = chartInfo(app);

  return (
    <div className="modal-overlay" onClick={close}>
      <div
        className="modal-dialog"
        style={{ width: "90vw", maxWidth: 1280 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" onClick={close} aria-label="close">
          ×
        </button>

        <h2 style={{ marginTop: 0, marginBottom: ".6rem" }}>
          {app.name} – <em>{project}</em>
        </h2>

        <p style={{ margin: 0 }}>
          <strong>{chart || "(unknown chart)"}</strong>
          {version && ` @ ${version}`}
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
                <h3 style={{ margin: "0 0 .4rem" }}>Chart defaults</h3>
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
                <h3 style={{ margin: "0 0 .4rem" }}>Override values</h3>
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
