import React, { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import Spinner      from "./Spinner.jsx";

/* ─── helper — fetch that auto-picks json/text ─────────────────── */
async function fetchSmart(url, { signal } = {}) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  return ct.includes("json") ? res.json() : res.text();
}

/* effect-wrapper with abort-on-unmount */
function useFetch(url, deps, cb) {
  useEffect(() => {
    if (!url) return;
    const ctrl = new AbortController();
    (async () => {
      try { cb(await fetchSmart(url, { signal: ctrl.signal })); }
      catch {/* ignore – caller decides */ }
    })();
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export default function ValuesEditor({ chart, onBack }) {
  const [versions, setVers] = useState([]);
  const [ver,      setVer ] = useState("");
  const [initVals, setInit] = useState("");       // only the *initial* YAML
  const [ns,       setNs ]  = useState(chart.name);
  const [busy,     setBusy] = useState(true);

  const edRef   = useRef(null);   // div that holds Monaco
  const monRef  = useRef(null);   // the Monaco editor instance
  const ymlRef  = useRef("");     // live YAML text (no re-renders)

  /* ① version list ----------------------------------------------------- */
  useFetch(
    `/api/chart/versions?owner=${chart.repoName}&chart=${chart.name}`,
    [chart.repoName, chart.name],
    (arr = []) => { setVers(arr); setVer(arr[0] || ""); }
  );

  /* ② initial values (proxy – CORS-free) ------------------------------- */
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
        if (!done) { setInit("# (no default values found)"); ymlRef.current = ""; setBusy(false); }
      }
    })();
    return () => { done = true; };
  }, [chart.packageId, ver]);

  /* ③ mount Monaco exactly once --------------------------------------- */
  useEffect(() => {
    if (busy || !edRef.current || monRef.current) return;

    monRef.current = monaco.editor.create(edRef.current, {
      value: initVals,
      language: "yaml",
      automaticLayout: true,
      minimap: { enabled: false },
    });

    monRef.current.onDidChangeModelContent(() => {
      ymlRef.current = monRef.current.getValue();   // keep latest YAML
    });

    return () => monRef.current?.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);    // ← NOT dependent on initVals anymore

  /* ④ deploy ----------------------------------------------------------- */
  async function submit() {
    if (!window.confirm(`Deploy ${chart.name}@${ver} into “${ns}”?`)) return;
    setBusy(true);
    await fetch("/api/apps", {
      method : "POST",
      headers: { "Content-Type": "application/json" },
      body   : JSON.stringify({
        chart   : chart.name,
        repo    : chart.repoURL,
        version : ver,
        release : chart.name,
        namespace: ns,
        userValuesYaml: ymlRef.current,     // ← live YAML
      }),
    });
    setBusy(false);
    alert("Deploy sent!");
    onBack();
  }

  /* ⑤ render (UI unchanged) ------------------------------------------- */
  return (
    <>
      <button className="btn-secondary btn-back" onClick={onBack}>
        ← Back
      </button>


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
            <p style={{ margin: ".1rem 0 0", fontSize: ".83rem", color: "var(--text-light)" }}>
              {chart.repoName}{chart.latest ? ` · latest ${chart.latest}` : ""}
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


      <label>Version</label>
      {versions.length ? (
        <select value={ver} onChange={e => setVer(e.target.value)}>
          {versions.map(v => <option key={v}>{v}</option>)}
        </select>
      ) : <em>no versions found</em>}

      <label style={{ marginTop: "1rem" }}>Namespace</label>
      <input
        value={ns}
        onChange={e => setNs(e.target.value)}
        style={{ width: "100%", padding: ".55rem .8rem", fontSize: ".95rem" }}
      />

      {busy ? (
        <div className="editor-placeholder"><Spinner size={36} /></div>
      ) : (
        <div ref={edRef} className="editor-frame" />
      )}

      <button className="btn" onClick={submit} disabled={busy || !ver}>
        {busy ? "Loading…" : "Install"}
      </button>
    </>
  );
}
