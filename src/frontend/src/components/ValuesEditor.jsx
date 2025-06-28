/*  ValuesEditor.jsx
    ───────────────────────────────────────────────────────────────
    Install / Download flow

      ① pick version
      ② (optional) enter App name + Namespace
      ③ tweak values.yaml  ← only if NOT download-only
      ④ Install ArgoCD Application  or  Download chart
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
      } catch {/* ignore */ }
    })();
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/* ────────────────────────────────────────────────────────────────
   Component
   ────────────────────────────────────────────────────────────── */

export default function ValuesEditor({ chart, onBack }) {
  /* ─── state ────────────────────────────────────────────────── */
  const [versions, setVers]   = useState([]);
  const [ver, setVer]         = useState("");
  const [initVals, setInit]   = useState("");
  const [appName, setAppName] = useState(chart.name);   // NEW
  const [ns, setNs]           = useState(chart.name);
  const [busy, setBusy]       = useState(true);
  const [preview, setPre]     = useState(null);
  const [downloadOnly, setDL] = useState(false);

  /* ─── refs ─────────────────────────────────────────────────── */
  const edDivRef = useRef(null);
  const edRef    = useRef(null);
  const ymlRef   = useRef("");

  /* ① versions list (Artifact Hub) */
  useFetch(
    `/api/chart/versions?owner=${chart.repoName}&chart=${chart.name}`,
    [chart.repoName, chart.name],
    (arr = []) => {
      setVers(arr);
      setVer(arr[0] || "");
    },
  );

  /* ② chart default values */
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

  /* ③ mount / dispose Monaco depending on download-only */
  useEffect(() => {
    if (downloadOnly && edRef.current) {
      edRef.current.dispose();
      edRef.current = null;
    }
    if (busy || downloadOnly || !edDivRef.current || edRef.current) return;

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
  }, [busy, downloadOnly]);

  /* ─── helpers ──────────────────────────────────────────────── */
  async function openPreview() {
    if (downloadOnly) return;
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

  async function deploy() {
    setBusy(true);

    const url  = downloadOnly ? "/api/download" : "/api/apps";
    let body;

    if (downloadOnly) {
      body = {
        chart: chart.name,
        repo:  chart.repoURL,
        version: ver,
      };
    } else {
      const deltaStr   = (preview?.delta || "").trim() || "# (no overrides)";
      const encodedStr = btoa(deltaStr);               // base-64 ⬅ NEW

      body = {
        chart:   chart.name,
        repo:    chart.repoURL,
        version: ver,
        release: appName,          // NEW → chosen Application name
        namespace: ns,
        userValuesYaml: encodedStr // base-64 encoded
      };
    }

    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      alert(downloadOnly ? "Download triggered!" : "Install request sent!");
      onBack();
    } finally {
      setBusy(false);
    }
  }

  /* ─── preview modal ────────────────────────────────────────── */
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
          onClick={(e) => e.stopPropagation()}
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
            >
              Back
            </button>
            <button className="btn" onClick={deploy}>
              {busy ? "Working…" : "Install ArgoCD Application"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ─── header (logo + meta) ─────────────────────────────────── */
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
          <h2 style={{ margin: 0 }}>
            {chart.displayName || chart.name}
          </h2>
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

  /* ─── render ───────────────────────────────────────────────── */
  const showEditor = !downloadOnly;

  return (
    <>
      {preview && !downloadOnly && <PreviewModal />}

      <button className="btn-secondary btn-back" onClick={onBack}>
        ← Back
      </button>

      <ChartHeader />

      {/* version selector */}
      <label>Version</label>
      {versions.length ? (
        <select value={ver} onChange={(e) => setVer(e.target.value)}>
          {versions.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      ) : (
        <em>no versions found</em>
      )}

      {/* download-only checkbox */}
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: ".55rem",
          marginTop: "1rem",
        }}
      >
        <input
          type="checkbox"
          checked={downloadOnly}
          onChange={(e) => setDL(e.target.checked)}
        />
        I want <strong>only to download</strong> this Helm chart (no
        Application yet)
      </label>

      {/* extra inputs only for install path */}
      {showEditor && (
        <>
          <label style={{ marginTop: "1rem" }}>Application&nbsp;name</label>
          <input
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
            style={{
              width: "100%",
              padding: ".55rem .8rem",
              fontSize: ".95rem",
            }}
          />

          <label style={{ marginTop: "1rem" }}>Namespace</label>
          <input
            value={ns}
            onChange={(e) => setNs(e.target.value)}
            style={{
              width: "100%",
              padding: ".55rem .8rem",
              fontSize: ".95rem",
            }}
          />

          {busy ? (
            <div className="editor-placeholder">
              <Spinner size={36} />
            </div>
          ) : (
            <div ref={edDivRef} className="editor-frame" />
          )}
        </>
      )}

      {/* primary action */}
      <button
        className="btn"
        onClick={downloadOnly ? deploy : openPreview}
        disabled={busy || !ver}
      >
        {busy
          ? "Working…"
          : downloadOnly
          ? "Download"
          : "Install ArgoCD Application"}
      </button>
    </>
  );
}
