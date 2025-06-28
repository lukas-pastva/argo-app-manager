/*  ValuesEditor.jsx
    ───────────────────────────────────────────────────────────────
    “Install chart” flow – lets the user

      ① pick version + namespace + release name
      ② (optionally) edit values.yaml
      ③ preview the *override-only* YAML (Δ)
      ④ install ArgoCD Application          – OR –
         download chart only (cache-fill)   ← new
*/

import React, { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import Spinner from "./Spinner.jsx";

/* ────────────────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────────────── */

/** fetch that auto-chooses .json() or .text() */
async function fetchSmart(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  return ct.includes("json") ? res.json() : res.text();
}

/** effect-wrapper that aborts the fetch if the component unmounts */
function useFetch(url, deps, cb) {
  useEffect(() => {
    if (!url) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        cb(await fetchSmart(url, { signal: ctrl.signal }));
      } catch {
        /* caller decides */
      }
    })();
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/* ────────────────────────────────────────────────────────────────
   Component
   ────────────────────────────────────────────────────────────── */

export default function ValuesEditor({ chart, onBack }) {
  /* ─── state ─────────────────────────────────────────────────── */
  const [versions, setVers] = useState([]);
  const [ver, setVer] = useState("");
  const [initVals, setInit] = useState(""); // default YAML from chart
  const [ns, setNs] = useState(chart.name);
  const [rel, setRel] = useState(chart.name); // release / Application name
  const [busy, setBusy] = useState(true);
  const [preview, setPre] = useState(null); // { delta:string } | null
  const [downloadOnly, setDLonly] = useState(false);
  const [full, setFull] = useState(false); // full-screen YAML editor?

  /* ─── refs ──────────────────────────────────────────────────── */
  const edDivRef = useRef(null); // embedded editor <div>
  const edRef = useRef(null); // Monaco editor instance
  const ymlRef = useRef(""); // live YAML text (no state churn)

  /* ① fetch version list (CORS-free via backend proxy) */
  useFetch(
    `/api/chart/versions?owner=${chart.repoName}&chart=${chart.name}`,
    [chart.repoName, chart.name],
    (arr = []) => {
      setVers(arr);
      setVer(arr[0] || "");
    },
  );

  /* ② fetch default values whenever the version changes */
  useEffect(() => {
    if (!ver) return;
    let done = false;
    (async () => {
      setBusy(true);
      try {
        const yml = await fetchSmart(
          `/api/chart/values?pkgId=${chart.packageId}&version=${ver}`,
        );
        if (!done) {
          setInit(yml);
          ymlRef.current = yml;
          setBusy(false);
        }
      } catch {
        if (!done) {
          const msg = "# (no default values found)";
          setInit(msg);
          ymlRef.current = msg;
          setBusy(false);
        }
      }
    })();
    return () => {
      done = true;
    };
  }, [chart.packageId, ver]);

  /* ③ mount Monaco exactly once */
  useEffect(() => {
    if (busy || !edDivRef.current || edRef.current) return;
    edRef.current = monaco.editor.create(edDivRef.current, {
      value: initVals,
      language: "yaml",
      automaticLayout: true,
      minimap: { enabled: false },
    });
    edRef.current.onDidChangeModelContent(() => {
      ymlRef.current = edRef.current.getValue();
    });
    return () => edRef.current?.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  /* ─── full-screen editor helpers ────────────────────────────── */
  function FullscreenEditor() {
    const ref = useRef(null);
    useEffect(() => {
      if (!ref.current) return;
      const e = monaco.editor.create(ref.current, {
        value: ymlRef.current,
        language: "yaml",
        automaticLayout: true,
        minimap: { enabled: false },
      });
      e.onDidChangeModelContent(() => {
        ymlRef.current = e.getValue();
      });
      const esc = ev => {
        if (ev.key === "Escape") setFull(false);
      };
      window.addEventListener("keydown", esc);
      return () => {
        e.dispose();
        window.removeEventListener("keydown", esc);
      };
    }, []);
    return (
      <div className="modal-overlay" onClick={() => setFull(false)}>
        <div
          className="modal-dialog"
          style={{ width: "90vw", height: "90vh", padding: 0 }}
          onClick={e => e.stopPropagation()}
        >
          <button
            className="modal-close"
            onClick={() => setFull(false)}
            aria-label="close"
            style={{ zIndex: 10 }}
          >
            ×
          </button>
          <div
            ref={ref}
            style={{
              width: "100%",
              height: "100%",
              borderRadius: "0 0 12px 12px",
            }}
          />
        </div>
      </div>
    );
  }

  /* ─── preview helpers ───────────────────────────────────────── */
  async function openPreview() {
    // download-only mode skips preview
    if (downloadOnly) {
      return deploy("");
    }
    setBusy(true);
    try {
      const delta = await fetchSmart("/api/delta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultYaml: initVals,
          userYaml: ymlRef.current,
        }),
      });
      setPre({ delta });
    } catch (e) {
      console.error("Δ-preview error:", e);
      alert("Could not compute YAML delta – see console.");
    } finally {
      setBusy(false);
    }
  }

  /* ─── install / download action ─────────────────────────────── */
  async function deploy(deltaOverride = null) {
    const deltaStr =
      deltaOverride !== null
        ? deltaOverride
        : (preview?.delta || "").trim() || "# (no overrides)";
    const payload = {
      chart: chart.name,
      repo: chart.repoURL,
      version: ver,
      release: rel,
      namespace: ns,
      name: rel,
      userValuesYaml:
        downloadOnly || deltaStr === "# (no overrides)"
          ? ""
          : btoa(unescape(encodeURIComponent(deltaStr))), // base64
    };

    setBusy(true);
    await fetch("/api/apps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    alert(downloadOnly ? "Download request sent!" : "Install sent!");
    onBack();
  }

  /* ─── preview modal ─────────────────────────────────────────── */
  function PreviewModal() {
    const mRef = useRef(null);
    useEffect(() => {
      if (!mRef.current) return;
      const e = monaco.editor.create(mRef.current, {
        value: preview.delta || "# (no overrides)",
        language: "yaml",
        readOnly: true,
        automaticLayout: true,
        minimap: { enabled: false },
      });
      return () => e.dispose();
    }, []);
    return (
      <div className="modal-overlay" onClick={() => setPre(null)}>
        <div
          className="modal-dialog"
          style={{ width: "64vw", maxWidth: 900 }}
          onClick={e => e.stopPropagation()}
        >
          <button
            className="modal-close"
            onClick={() => setPre(null)}
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
            Only the keys that differ from chart defaults will be saved.
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
              onClick={() => setPre(null)}
              disabled={busy}
            >
              Back
            </button>
            <button
              className="btn"
              onClick={() => deploy(deltaStr => deltaStr)}
              disabled={busy}
            >
              {busy ? "Saving…" : "Install"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ─── header (logo + meta) ──────────────────────────────────── */
  function ChartHeader() {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "1rem",
          marginBottom: "1.1rem",
        }}
      >
        {chart.logo && (
          <img
            src={chart.logo}
            alt=""
            style={{
              width: 48,
              height: 48,
              borderRadius: 6,
              objectFit: "contain",
              background: "#fff",
              flexShrink: 0,
            }}
          />
        )}
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0 }}>{chart.displayName || chart.name}</h2>
          {chart.repoName && (
            <p
              style={{
                margin: ".1rem 0 0",
                fontSize: ".83rem",
                color: "var(--text-light)",
              }}
            >
              {chart.repoName}
              {chart.latest ? ` · latest ${chart.latest}` : ""}
            </p>
          )}
          {chart.description && (
            <p
              style={{
                margin: ".45rem 0 0",
                fontSize: ".9rem",
                color: "var(--text-light)",
                maxWidth: "60ch",
              }}
            >
              {chart.description}
            </p>
          )}
        </div>
      </div>
    );
  }

  /* ─── render ────────────────────────────────────────────────── */
  return (
    <>
      {/* overlays */}
      {preview && <PreviewModal />}
      {full && <FullscreenEditor />}

      <button className="btn-secondary btn-back" onClick={onBack}>
        ← Back
      </button>

      <ChartHeader />

      {/* version selector */}
      <label>Version</label>
      {versions.length ? (
        <select value={ver} onChange={e => setVer(e.target.value)}>
          {versions.map(v => (
            <option key={v}>{v}</option>
          ))}
        </select>
      ) : (
        <em>no versions found</em>
      )}

      {/* release / namespace */}
      <label style={{ marginTop: "1rem" }}>Application (release) name</label>
      <input
        value={rel}
        onChange={e => setRel(e.target.value)}
        style={{ width: "100%", padding: ".55rem .8rem", fontSize: ".95rem" }}
      />

      <label style={{ marginTop: "1rem" }}>Namespace</label>
      <input
        value={ns}
        onChange={e => setNs(e.target.value)}
        style={{ width: "100%", padding: ".55rem .8rem", fontSize: ".95rem" }}
      />

      {/* download-only toggle */}
      <label style={{ marginTop: "1.2rem", display: "flex", gap: ".5rem" }}>
        <input
          type="checkbox"
          checked={downloadOnly}
          onChange={e => setDLonly(e.target.checked)}
          style={{ transform: "translateY(2px)" }}
        />
        <span>I want only to download this Helm chart (do not install)</span>
      </label>

      {/* editor or spinner – hidden when download-only */}
      {!downloadOnly && (
        <>
          {busy ? (
            <div className="editor-placeholder">
              <Spinner size={36} />
            </div>
          ) : (
            <div style={{ position: "relative" }}>
              <button
                className="btn-secondary"
                style={{
                  position: "absolute",
                  top: 6,
                  right: 6,
                  padding: ".25rem .6rem",
                  fontSize: ".8rem",
                  zIndex: 5,
                }}
                onClick={() => setFull(true)}
              >
                ⤢ Full screen
              </button>
              <div ref={edDivRef} className="editor-frame" />
            </div>
          )}
        </>
      )}

      {/* primary action button */}
      <button
        className="btn"
        onClick={openPreview}
        disabled={busy || !ver || !rel || !ns}
      >
        {busy
          ? "Working…"
          : downloadOnly
          ? "Download chart"
          : "Install"}
      </button>
    </>
  );
}
