/*  ValuesEditor.jsx
    ───────────────────────────────────────────────────────────────
    “Install chart” flow – lets the user

      ① pick version + (optional) namespace
      ② tweak values.yaml        ··· only if NOT download-only
      ③ preview the override YAML · only if installing
      ④ Install  or  Download-only
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
  /* ─── state ────────────────────────────────────────────────── */
  const [versions, setVers]   = useState([]);
  const [ver, setVer]         = useState("");
  const [initVals, setInit]   = useState("");       // initial YAML
  const [ns, setNs]           = useState(chart.name);
  const [busy, setBusy]       = useState(true);
  const [preview, setPre]     = useState(null);     // { delta:string } | null
  const [downloadOnly, setDL] = useState(false);    // ⬅ NEW

  /* ─── refs ─────────────────────────────────────────────────── */
  const edDivRef = useRef(null);   // <div> hosting Monaco
  const edRef    = useRef(null);   // Monaco instance
  const ymlRef   = useRef("");     // live YAML text

  /* ① fetch version list (CORS-free via backend) */
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

  /* ③ mount / dispose Monaco depending on download-only toggle */
  useEffect(() => {
    // dispose editor when switching to download-only
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
    if (downloadOnly) return; // not relevant
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
      console.error("Unable to compute YAML delta:", e);
      alert("⚠️  Could not compute YAML delta. Check console.");
    } finally {
      setBusy(false);
    }
  }

  async function deploy() {
    setBusy(true);

    /* choose endpoint based on mode */
    const url = downloadOnly ? "/api/download" : "/api/apps";

    const body = downloadOnly
      ? {
          chart: chart.name,
          repo: chart.repoURL,
          version: ver,
        }
      : {
          chart: chart.name,
          repo: chart.repoURL,
          version: ver,
          release: chart.name,
          namespace: ns,
          userValuesYaml:
            (preview?.delta || "").trim() || "# (no overrides)",
        };

    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      alert(downloadOnly ? "Download triggered!" : "Deploy sent!");
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
              {busy ? "Saving…" : "Install"}
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

      {/* namespace + editor – only for install */}
      {showEditor && (
        <>
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

      {/* primary action button */}
      <button
        className="btn"
        onClick={downloadOnly ? deploy : openPreview}
        disabled={busy || !ver}
      >
        {busy
          ? "Working…"
          : downloadOnly
          ? "Download"
          : "Install"}
      </button>
    </>
  );
}
