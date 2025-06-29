/*  ValuesEditor.jsx
    ───────────────────────────────────────────────────────────────
    “Install chart” flow – lets the user
      ① pick version + namespace + application name
      ② (optionally) edit values.yaml
      ③ preview the *override-only* YAML (Δ)
      ④ install ArgoCD Application          – OR –
         download chart only (cache-fill)
*/

import React, { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import Spinner from "./Spinner.jsx";

/* ── helpers ──────────────────────────────────────────────────── */
async function fetchSmart(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  return ct.includes("json") ? res.json() : res.text();
}
function useFetch(url, deps, cb) {
  useEffect(() => {
    if (!url) return;
    const ctrl = new AbortController();
    (async () => {
      try { cb(await fetchSmart(url, { signal: ctrl.signal })); } catch {}
    })();
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
/* pretty YYYY-MM-DD */
const fmtDate = iso => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toISOString().slice(0, 10);
};

/* ── component ───────────────────────────────────────────────── */
export default function ValuesEditor({ chart, onBack }) {

  /* state */
  const [versions, setVers] = useState([]);     // [{version,date}, …]
  const [ver, setVer]       = useState("");
  const [initVals, setInit] = useState("");
  const [ns, setNs]         = useState(chart.name);
  const [name, setName]     = useState(chart.name);
  const [busy, setBusy]     = useState(true);
  const [preview, setPre]   = useState(null);   // { delta } | null
  const [downloadOnly, setDL]= useState(false);
  const [full, setFull]     = useState(false);  // full-screen editor open?

  /* refs */
  const edDivRef = useRef(null);   // inline editor DOM node
  const edRef    = useRef(null);   // Monaco instance (inline)
  const ymlRef   = useRef("");     // current YAML text

  /* ① fetch versions (owner = repoName, now with dates) -------- */
  useFetch(
    `/api/chart/versions?owner=${encodeURIComponent(chart.repoName)}&chart=${encodeURIComponent(chart.name)}`,
    [chart.name, chart.repoName],
    (arr = []) => { setVers(arr); setVer(arr[0]?.version || ""); }
  );

  /* ② fetch default values for selected version ---------------- */
  useEffect(() => {
    if (!ver) return;
    let cancelled = false;

    (async () => {
      setBusy(true);
      try {
        const yml = await fetchSmart(
          `/api/chart/values?pkgId=${chart.packageId}&version=${ver}`
        );
        if (!cancelled) {
          setInit(yml);
          ymlRef.current = yml;
          setBusy(false);
        }
      } catch {
        if (!cancelled) {
          const msg = "# (no default values found)";
          setInit(msg);
          ymlRef.current = msg;
          setBusy(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [chart.packageId, ver]);

  /* ③ mount inline Monaco once -------------------------------- */
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
  }, [busy, initVals]);

  /* ────────────────────────────────────────────────────────────
     BUG-FIX: re-paint Monaco when overlays close
     ────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!preview && edRef.current) {
      edRef.current.layout();           // preview dialog closed
    }
  }, [preview]);

  useEffect(() => {
    if (!full && edRef.current) {       // left full-screen
      edRef.current.setValue(ymlRef.current); // sync edits
      edRef.current.layout();
    }
  }, [full]);

  /* ── full-screen editor helper ─────────────────────────────── */
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

      const esc = ev => { if (ev.key === "Escape") setFull(false); };
      window.addEventListener("keydown", esc);

      return () => {
        ymlRef.current = e.getValue();            // sync back
        edRef.current?.setValue(ymlRef.current);
        edRef.current?.layout();
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
          <button className="modal-close" onClick={() => setFull(false)}>
            ×
          </button>
          <div ref={ref} style={{ width: "100%", height: "100%" }} />
        </div>
      </div>
    );
  }

  /* ── delta-preview helper ------------------------------------ */
  async function openPreview() {
    if (downloadOnly) { deploy(""); return; }

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
      console.error("Δ-preview failed:", e);
      alert("Unable to compute YAML delta.");
    } finally {
      setBusy(false);
    }
  }

  /* ── main action (install / download) ------------------------ */
  async function deploy(deltaOverride) {
    const deltaStr =
      (deltaOverride ?? (preview?.delta || "").trim()) || "# (no overrides)";
    const endpoint = downloadOnly ? "/api/download" : "/api/apps";

    const base = {
      chart  : chart.name,
      version: ver,
      repo   : chart.repoURL,
      owner  : chart.repoName,
    };

    const payload = downloadOnly
      ? { ...base, release: name }
      : {
          ...base,
          name,
          release: name,
          namespace: ns,
          userValuesYaml:
            deltaStr === "# (no overrides)"
              ? ""
              : btoa(unescape(encodeURIComponent(deltaStr))),
        };

    setBusy(true);
    await fetch(endpoint, {
      method : "POST",
      headers: { "Content-Type": "application/json" },
      body   : JSON.stringify(payload),
    });
    setBusy(false);

    alert(downloadOnly ? "Download request sent!" : "Install request sent!");
    onBack();
  }

  /* ── preview modal ------------------------------------------ */
  function PreviewModal() {
    const mRef = useRef(null);

    useEffect(() => {
      if (!mRef.current) return;
      const e = monaco.editor.create(mRef.current, {
        value: preview?.delta || "# (no overrides)",
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
          <button className="modal-close" onClick={() => setPre(null)}>
            ×
          </button>
          <h2 style={{ margin: "0 0 .5rem" }}>Override values preview</h2>
          <p style={{ margin: "0 0 1rem", fontSize: ".85rem", color: "var(--text-light)" }}>
            Only the keys that differ from chart defaults will be saved.
          </p>
          <div
            ref={mRef}
            style={{ height: "50vh", border: "1px solid var(--border)", borderRadius: 6 }}
          />
          <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end", marginTop: "1.1rem" }}>
            <button className="btn-secondary" onClick={() => setPre(null)} disabled={busy}>Back</button>
            <button className="btn" onClick={() => deploy()} disabled={busy}>
              {busy ? "Saving…" : "Install"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── header helper ------------------------------------------ */
  function ChartHeader() {
    return (
      <div style={{ display: "flex", alignItems: "flex-start", gap: "1rem", marginBottom: "1.1rem" }}>
        {chart.logo && (
          <img
            src={chart.logo}
            alt=""
            style={{
              width: 48, height: 48, borderRadius: 6,
              objectFit: "contain", background: "#fff", flexShrink: 0
            }}
          />
        )}
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0 }}>{chart.displayName || chart.name}</h2>
          {chart.repoName && (
            <p style={{ margin: ".1rem 0 0", fontSize: ".83rem", color: "var(--text-light)" }}>
              {chart.repoName}{chart.latest ? ` · latest ${chart.latest}` : ""}
            </p>
          )}
          {chart.description && (
            <p style={{ margin: ".45rem 0 0", fontSize: ".9rem", color: "var(--text-light)", maxWidth: "60ch" }}>
              {chart.description}
            </p>
          )}
        </div>
      </div>
    );
  }

  /* ── render -------------------------------------------------- */
  return (
    <>
      {preview && <PreviewModal />}
      {full    && <FullscreenEditor />}

      <button className="btn-secondary btn-back" onClick={onBack}>← Back</button>
      <ChartHeader />

      {/* version dropdown with date */}
      <label>Version</label>
      {versions.length ? (
        <select value={ver} onChange={e => setVer(e.target.value)}>
          {versions.map(v => (
            <option key={v.version} value={v.version}>
              {v.version}{v.date ? `  –  ${fmtDate(v.date)}` : ""}
            </option>
          ))}
        </select>
      ) : (
        <em>no versions found</em>
      )}

      {/* application / namespace inputs */}
      <label style={{ marginTop: "1rem" }}>Application name</label>
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        style={{ width: "100%", padding: ".55rem .8rem", fontSize: ".95rem" }}
      />

      <label style={{ marginTop: "1rem" }}>Namespace</label>
      <input
        value={ns}
        onChange={e => setNs(e.target.value)}
        style={{ width: "100%", padding: ".55rem .8rem", fontSize: ".95rem" }}
      />

      {/* download-only checkbox */}
      <label style={{ marginTop: "1.2rem", display: "flex", gap: ".5rem" }}>
        <input
          type="checkbox"
          checked={downloadOnly}
          onChange={e => setDL(e.target.checked)}
          style={{ transform: "translateY(2px)" }}
        />
        <span>I want only to download this Helm chart (do not install)</span>
      </label>

      {/* values editor (inline) */}
      {!downloadOnly && (
        busy ? (
          <div className="editor-placeholder"><Spinner size={36} /></div>
        ) : (
          <div style={{ position: "relative" }}>
            <button
              className="btn-secondary"
              style={{ position: "absolute", top: 6, right: 6,
                       padding: ".25rem .6rem", fontSize: ".8rem", zIndex: 5 }}
              onClick={() => setFull(true)}
            >
              ⤢ Full screen
            </button>
            <div ref={edDivRef} className="editor-frame" />
          </div>
        )
      )}

      {/* primary action */}
      <button
        className="btn"
        onClick={openPreview}
        disabled={busy || !ver || !name || !ns}
      >
        {busy ? "Working…" : downloadOnly ? "Download chart" : "Install"}
      </button>
    </>
  );
}
