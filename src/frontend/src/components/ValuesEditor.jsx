/*  ValuesEditor.jsx
    ───────────────────────────────────────────────────────────────
    Install / Download flow with full-screen YAML editor
*/

import React, { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import Spinner from "./Spinner.jsx";

/* helper that auto-picks .json() / .text() ---------------------- */
async function fetchSmart(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  return ct.includes("json") ? res.json() : res.text();
}

/* abort-aware fetch wrapper ------------------------------------ */
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

/*────────────────────────────────────────────────────────────────*/
export default function ValuesEditor({ chart, onBack }) {
  /* state ------------------------------------------------------ */
  const [versions, setVers]   = useState([]);
  const [ver, setVer]         = useState("");
  const [initVals, setInit]   = useState("");
  const [appName, setAppName] = useState(chart.name);
  const [ns, setNs]           = useState(chart.name);
  const [busy, setBusy]       = useState(true);
  const [preview, setPre]     = useState(null);
  const [downloadOnly, setDL] = useState(false);
  const [full, setFull]       = useState(false);       // full-screen?

  /* refs ------------------------------------------------------- */
  const baseDivRef    = useRef(null);   // inline editor host
  const baseEdRef     = useRef(null);   // Monaco instance (inline)
  const overlayDivRef = useRef(null);   // full-screen host
  const overlayEdRef  = useRef(null);   // Monaco instance (full)
  const ymlRef        = useRef("");     // live YAML

  /* fetch versions list --------------------------------------- */
  useFetch(
    `/api/chart/versions?owner=${chart.repoName}&chart=${chart.name}`,
    [chart.repoName, chart.name],
    (arr = []) => { setVers(arr); setVer(arr[0] || ""); },
  );

  /* fetch default values on version change -------------------- */
  useEffect(() => {
    if (!ver) return;
    let done = false;
    (async () => {
      setBusy(true);
      try {
        const yml = await fetchSmart(
          `/api/chart/values?pkgId=${chart.packageId}&version=${ver}`,
        );
        if (!done) { setInit(yml); ymlRef.current = yml; setBusy(false); }
      } catch {
        if (!done) {
          const msg = "# (no default values found)";
          setInit(msg); ymlRef.current = msg; setBusy(false);
        }
      }
    })();
    return () => { done = true; };
  }, [chart.packageId, ver]);

  /* create *inline* Monaco editor (once) ---------------------- */
  useEffect(() => {
    if (busy || downloadOnly || !baseDivRef.current || baseEdRef.current)
      return;

    baseEdRef.current = monaco.editor.create(baseDivRef.current, {
      value: initVals,
      language: "yaml",
      automaticLayout: true,
      minimap: { enabled: false },
    });
    baseEdRef.current.onDidChangeModelContent(() => {
      ymlRef.current = baseEdRef.current.getValue();
    });

    return () => baseEdRef.current?.dispose();
  }, [busy, downloadOnly, initVals]);

  /* full-screen: create / destroy overlay editor -------------- */
  useEffect(() => {
    if (!full) {
      /* leaving full-screen → sync back value + cleanup */
      overlayEdRef.current?.dispose();
      overlayEdRef.current = null;
      if (baseEdRef.current) {
        baseEdRef.current.setValue(ymlRef.current);
        baseDivRef.current.style.display = "";          // un-hide
      }
      return;
    }

    /* entering full-screen */
    if (!overlayDivRef.current) return;
    baseDivRef.current.style.display = "none";          // hide inline

    overlayEdRef.current = monaco.editor.create(overlayDivRef.current, {
      value: ymlRef.current,
      language: "yaml",
      automaticLayout: true,
      minimap: { enabled: false },
    });
    overlayEdRef.current.onDidChangeModelContent(() => {
      ymlRef.current = overlayEdRef.current.getValue();
    });

    /* Esc to leave full-screen */
    const h = e => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", h);

    return () => window.removeEventListener("keydown", h);
  }, [full]);

  /* preview helper -------------------------------------------- */
  async function openPreview() {
    if (downloadOnly) return;
    setBusy(true);
    try {
      const delta = await fetchSmart("/api/delta", {
        method : "POST",
        headers: { "Content-Type": "application/json" },
        body   : JSON.stringify({ defaultYaml: initVals, userYaml: ymlRef.current }),
      });
      setPre({ delta });
    } catch (e) {
      console.error("Δ-preview error:", e);
      alert("Could not compute YAML delta – see console.");
    } finally { setBusy(false); }
  }

  /* install / download --------------------------------------- */
  async function deploy() {
    setBusy(true);
    const url  = downloadOnly ? "/api/download" : "/api/apps";
    let   body;

    if (downloadOnly) {
      body = { chart: chart.name, repo: chart.repoURL, version: ver };
    } else {
      const deltaStr = (preview?.delta || "").trim() || "# (no overrides)";
      body = {
        name:       appName,
        chart:      chart.name,
        version:    ver,
        release:    appName,
        namespace:  ns,
        userValuesYaml: btoa(deltaStr),   // base-64 encode
      };
    }

    try {
      await fetch(url, {
        method : "POST",
        headers: { "Content-Type": "application/json" },
        body   : JSON.stringify(body),
      });
      alert(downloadOnly ? "Download triggered!" : "Install request sent!");
      onBack();
    } finally { setBusy(false); }
  }

  /* header ----------------------------------------------------- */
  const Header = () => (
    <div style={{ display:"flex", gap:"1rem", marginBottom:"1.1rem" }}>
      {chart.logo && (
        <img src={chart.logo} alt=""
             style={{ width:48,height:48,borderRadius:6,
                      objectFit:"contain",background:"#fff" }}/>
      )}
      <div style={{ minWidth:0 }}>
        <h2 style={{ margin:0 }}>{chart.displayName || chart.name}</h2>
        {chart.repoName && (
          <p style={{ margin:".1rem 0 0",fontSize:".83rem",color:"var(--text-light)" }}>
            {chart.repoName}{chart.latest ? ` · latest ${chart.latest}` : ""}
          </p>
        )}
        {chart.description && (
          <p style={{ margin:".45rem 0 0",fontSize:".9rem",
                     color:"var(--text-light)",maxWidth:"60ch" }}>
            {chart.description}</p>
        )}
      </div>
    </div>
  );

  /*──────────────────────────────── RENDER ───────────────────────────────*/
  const showEditor = !downloadOnly;

  return (
    <>
      {/* full-screen overlay (only when active) */}
      {full && showEditor && (
        <div className="modal-overlay" onClick={() => setFull(false)}>
          <div
            className="modal-dialog"
            style={{ width:"94vw",height:"88vh",padding:"1rem" }}
            onClick={e => e.stopPropagation()}
          >
            <button
              style={{
                position:"absolute",top:".4rem",right:".6rem",
                fontSize:"1.8rem",border:"none",background:"none",
                color:"var(--text-light)",cursor:"pointer",
                zIndex:2000,                          /* always on top */
              }}
              onClick={() => setFull(false)}
              aria-label="close"
            >×</button>

            <div
              ref={overlayDivRef}
              style={{
                height:"100%",
                border:"1px solid var(--border)",
                borderRadius:6,
                overflow:"hidden",
              }}
            />
          </div>
        </div>
      )}

      {/* regular view */}
      <button className="btn-secondary btn-back" onClick={onBack}>← Back</button>
      <Header />

      <label>Version</label>
      {versions.length ? (
        <select value={ver} onChange={e => setVer(e.target.value)}>
          {versions.map(v => <option key={v}>{v}</option>)}
        </select>
      ) : <em>no versions found</em>}

      <label style={{ display:"flex",alignItems:"center",gap:".55rem",marginTop:"1rem" }}>
        <input type="checkbox" checked={downloadOnly} onChange={e=>setDL(e.target.checked)}/>
        I want <strong>only to download</strong> this Helm chart
      </label>

      {showEditor && (
        <>
          <label style={{ marginTop:"1rem" }}>Application&nbsp;name</label>
          <input
            value={appName}
            onChange={e=>setAppName(e.target.value)}
            style={{ width:"100%",padding:".55rem .8rem",fontSize:".95rem" }}
          />

          <label style={{ marginTop:"1rem" }}>Namespace</label>
          <input
            value={ns}
            onChange={e=>setNs(e.target.value)}
            style={{ width:"100%",padding:".55rem .8rem",fontSize:".95rem" }}
          />

          {busy ? (
            <div className="editor-placeholder"><Spinner size={36}/></div>
          ) : (
            <div style={{ position:"relative" }}>
              <button
                className="btn-secondary"
                style={{
                  position:"absolute",top:6,right:6,fontSize:".8rem",
                  padding:".25rem .6rem",zIndex:1000
                }}
                onClick={()=>setFull(true)}
                title="Maximise editor"
              >⤢</button>

              <div
                ref={baseDivRef}
                className="editor-frame"
                style={{ display: full ? "none" : "block" }}
              />
            </div>
          )}
        </>
      )}

      <button
        className="btn"
        style={{ marginTop:"1.2rem" }}
        disabled={busy || !ver}
        onClick={downloadOnly ? deploy : openPreview}
      >
        {busy
          ? "Working…"
          : downloadOnly
          ? "Download"
          : "Install ArgoCD Application"}
      </button>

      {/* YAML Δ preview modal */}
      {preview && !downloadOnly && (
        <div className="modal-overlay" onClick={()=>setPre(null)}>
          <div
            className="modal-dialog"
            style={{ width:"64vw",maxWidth:900 }}
            onClick={e=>e.stopPropagation()}
          >
            <button className="modal-close" onClick={()=>setPre(null)} aria-label="close">×</button>
            <h2 style={{ margin:"0 0 .5rem" }}>Override values preview</h2>
            <p style={{ margin:"0 0 1rem",fontSize:".85rem",color:"var(--text-light)" }}>
              Only the keys that differ from chart defaults will be saved.
            </p>
            <div
              style={{
                height:"50vh",border:"1px solid var(--border)",borderRadius:6,
                overflow:"hidden"
              }}
              ref={node=>{
                if (!node) return;
                const ed = monaco.editor.create(node,{
                  value:preview.delta||"# (no overrides)",
                  language:"yaml",readOnly:true,
                  automaticLayout:true,minimap:{enabled:false},
                });
                return ()=>ed.dispose();
              }}
            />
            <div style={{ display:"flex",gap:"1rem",justifyContent:"flex-end",marginTop:"1.1rem" }}>
              <button className="btn-secondary" onClick={()=>setPre(null)}>Back</button>
              <button className="btn" onClick={deploy}>
                {busy?"Saving…":"Install ArgoCD Application"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
