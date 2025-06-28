/*  AppDetails.jsx
    ───────────────────────────────────────────────────────────────
    Modal that shows
      • chart default values (read-only, never editable)
      • override values   (view → edit → preview → save/upgrade)
      • optional meta (description / home / maintainers)
*/

import React, { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import Spinner from "./Spinner.jsx";

/* helper – returns { chart, version } for either source style */
function chartInfo(app) {
  if (app.chart) {
    return { chart: app.chart, version: app.targetRevision || "" };
  }
  const seg = (app.path || "").split("/").filter(Boolean);
  return { chart: seg.at(-2) || "", version: seg.at(-1) || "" };
}

/*──────────────────────────────────────────────────────────────────*/

export default function AppDetails({ project, file, app, onClose }) {
  /* state ------------------------------------------------------- */
  const [vals, setVals] = useState({
    defaultValues: "",
    overrideValues: "",
    meta: {},
  });
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(null); // { delta } | null
  const [busy, setBusy] = useState(false);

  /* refs -------------------------------------------------------- */
  const defDivRef = useRef(null); // left-side viewer
  const ovrDivRef = useRef(null); // right-side view / editor
  const ovrEdRef = useRef(null);  // Monaco instance (override)
  const yamlRef  = useRef("");    // live override YAML text

  /* lock body scroll while modal open -------------------------- */
  useEffect(() => {
    document.body.classList.add("modal-open");
    return () => document.body.classList.remove("modal-open");
  }, []);

  /* fetch values once ------------------------------------------ */
  useEffect(() => {
    const { chart, version } = chartInfo(app);
    const qs = new URLSearchParams({
      project,
      name: app.name,
      chart,
      version,
      repoURL: app.repoURL,
      path: app.path,
      file,
    });

    fetch(`/api/app/values?${qs.toString()}`)
      .then((r) => r.json())
      .then((j) => {
        setVals({
          defaultValues: j.defaultValues || "",
          overrideValues: j.overrideValues || "",
          meta: j.meta || {},
        });
        yamlRef.current = j.overrideValues || "";
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [project, file, app]);

  /* mount left-hand (default) viewer once data ready ------------ */
  useEffect(() => {
    if (loading || !defDivRef.current) return;
    const e = monaco.editor.create(defDivRef.current, {
      value: vals.defaultValues || "# (no values.yaml found)",
      language: "yaml",
      readOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
    });
    return () => e.dispose();
  }, [loading, vals.defaultValues]);

  /* mount / remount right-hand viewer or editable editor -------- */
  useEffect(() => {
    if (loading || !ovrDivRef.current) return;

    // dispose any previous instance first
    ovrEdRef.current?.dispose();

    ovrEdRef.current = monaco.editor.create(ovrDivRef.current, {
      value: yamlRef.current || "# (no override file)",
      language: "yaml",
      readOnly: !editing,
      automaticLayout: true,
      minimap: { enabled: false },
    });

    if (editing) {
      ovrEdRef.current.onDidChangeModelContent(() => {
        yamlRef.current = ovrEdRef.current.getValue();
      });
    }

    return () => ovrEdRef.current?.dispose();
  }, [loading, editing, vals.overrideValues]);

  /* helper – YAML delta preview -------------------------------- */
  async function openPreview() {
    setBusy(true);
    try {
      const delta = await fetch("/api/delta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultYaml: vals.defaultValues,
          userYaml: yamlRef.current,
        }),
      }).then((r) => r.text());
      setPreview({ delta });
    } catch (e) {
      console.error("Δ-preview error:", e);
      alert("Could not compute YAML delta – see console.");
    } finally {
      setBusy(false);
    }
  }

  /* helper – perform helm upgrade via backend ------------------ */
  async function saveUpgrade() {
    setBusy(true);
    const { chart, version } = chartInfo(app);
    const ns = app.destinationNamespace || app.namespace || "default";

    try {
      await fetch("/api/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chart,
          repo: app.repoURL,
          version,
          release: app.name,
          namespace: ns,
          userValuesYaml: yamlRef.current,
        }),
      }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      });

      alert("Upgrade triggered!");
      setEditing(false);
      setPreview(null);
    } catch (e) {
      console.error("upgrade error:", e);
      alert(`Upgrade failed – ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  /* preview modal ---------------------------------------------- */
  function PreviewModal() {
    const mRef = useRef(null);

    useEffect(() => {
      if (!mRef.current) return;
      const e = monaco.editor.create(mRef.current, {
        value: preview?.delta || "# (no changes)",
        language: "yaml",
        readOnly: true,
        automaticLayout: true,
        minimap: { enabled: false },
      });
      return () => e.dispose();
    }, []);

    return (
      <div className="modal-overlay" onClick={() => setPreview(null)}>
        <div
          className="modal-dialog"
          style={{ width: "64vw", maxWidth: 900 }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="modal-close"
            onClick={() => setPreview(null)}
            aria-label="close"
          >
            ×
          </button>
          <h2 style={{ margin: "0 0 .5rem" }}>Override values preview</h2>
          <p
            style={{
              margin: "0 0 1rem",
              fontSize: ".85rem",
              color: "var(--text-light)",
            }}
          >
            Only the keys that differ from chart defaults will be applied.
          </p>
          <div
            ref={mRef}
            style={{
              height: "50vh",
              border: "1px solid var(--border)",
              borderRadius: 6,
            }}
          />
          <div
            style={{
              display: "flex",
              gap: "1rem",
              justifyContent: "flex-end",
              marginTop: "1.1rem",
            }}
          >
            <button
              className="btn-secondary"
              onClick={() => setPreview(null)}
            >
              Back
            </button>
            <button className="btn" onClick={saveUpgrade} disabled={busy}>
              {busy ? "Saving…" : "Save & upgrade"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* tiny component for optional meta box ----------------------- */
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

  /* close helper ----------------------------------------------- */
  const close = () => {
    document.body.classList.remove("modal-open");
    onClose();
  };

  /* render ------------------------------------------------------ */
  const { chart, version } = chartInfo(app);

  return (
    <div className="modal-overlay" onClick={close}>
      {preview && <PreviewModal />}

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
              {/* chart defaults (always read-only) */}
              <div>
                <h3 style={{ margin: "0 0 .4rem" }}>Chart defaults</h3>
                <p
                  style={{
                    margin: "0 0 .4rem",
                    fontSize: ".8rem",
                    color: "var(--text-light)",
                  }}
                >
                  This column is static – defaults come directly from the Helm
                  chart and <strong>cannot</strong> be edited.
                </p>
                <div
                  ref={defDivRef}
                  style={{
                    height: "48vh",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                  }}
                />
              </div>

              {/* override values (view / edit) */}
              <div>
                <h3 style={{ margin: "0 0 .4rem" }}>Override values</h3>
                {!editing && (
                  <p
                    style={{
                      margin: "0 0 .4rem",
                      fontSize: ".8rem",
                      color: "var(--text-light)",
                    }}
                  >
                    These YAML snippets override the defaults on the left using
                    Helm’s <code>values.yaml</code> merge rules.
                  </p>
                )}

                {/* wrapper allows floating “Edit” button */}
                <div className="ovr-wrapper">
                  {/* floating Edit button – only when NOT editing */}
                  {!editing && (
                    <button
                      className="btn-secondary edit-fab"
                      onClick={() => {
                        if (
                          window.confirm(
                            "Editing override values will trigger a Helm upgrade of this release. Continue?",
                          )
                        ) {
                          setEditing(true);
                        }
                      }}
                    >
                      Edit
                    </button>
                  )}

                  <div ref={ovrDivRef} className="editor-frame" />
                </div>

                {/* action buttons – only while editing */}
                {editing && (
                  <div
                    style={{
                      display: "flex",
                      gap: ".6rem",
                      marginTop: ".8rem",
                    }}
                  >
                    <button
                      className="btn-secondary"
                      onClick={() => {
                        setEditing(false);
                        yamlRef.current = vals.overrideValues || "";
                      }}
                      disabled={busy}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn"
                      onClick={openPreview}
                      disabled={busy}
                    >
                      {busy ? "Working…" : "Preview & save"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
