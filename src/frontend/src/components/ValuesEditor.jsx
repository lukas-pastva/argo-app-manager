import React, { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import Spinner from "./Spinner.jsx";

const AH_BASE = "https://artifacthub.io/api/v1";

/**
 * A very small hook-ish helper that fetches JSON and aborts if the component
 * unmounts before the request finishes – avoids annoying React warnings.
 */
function useFetchJSON(url, deps, setData, setBusy) {
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      setBusy(true);
      try {
        const data = await fetch(url, { signal: ctrl.signal }).then(r => r.json());
        setData(data);
      } finally {
        setBusy(false);
      }
    })();
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export default function ValuesEditor({ chart, onBack }) {
  /* props coming from ChartSearch ---------------------------------------- */
  // chart.repoName   -> AH repository slug (e.g. "grafana")
  // chart.name       -> chart name        (e.g. "loki-stack")
  // chart.packageId  -> UUID

  const [versions, setVers] = useState([]);
  const [ver,      setVer ] = useState("");
  const [vals,     setVals] = useState("");
  const [ns,       setNs ]  = useState(chart.name);   // sensible default
  const [busy,     setBusy] = useState(true);

  const editorRef  = useRef(null);

  /* ① load version list once -------------------------------------------- */
  useFetchJSON(
    `${AH_BASE}/packages/helm/${chart.repoName}/${chart.name}`,
    [chart.repoName, chart.name],
    pkg => {
      // AH returns newest first – keep that order, extract only the string
      const v = pkg.available_versions.map(v => v.version);
      setVers(v);
      setVer(v[0] || "");
    },
    setBusy
  );

  /* ② load default values every time the version changes ---------------- */
  useFetchJSON(
    ver
      ? `${AH_BASE}/packages/${chart.packageId}/${ver}/values`
      : null,
    [chart.packageId, ver],
    yml => setVals(typeof yml === "string" ? yml : ""),
    setBusy
  );

  /* ③ mount Monaco once values arrive ----------------------------------- */
  useEffect(() => {
    if (busy || !editorRef.current) return;
    const ed = monaco.editor.create(editorRef.current, {
      value: vals,
      language: "yaml",
      automaticLayout: true,
      minimap: { enabled: false }
    });
    ed.onDidChangeModelContent(() => setVals(ed.getValue()));
    return () => ed.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  /* ④ deploy ------------------------------------------------------------ */
  async function submit() {
    if (!window.confirm(`Deploy ${chart.name}@${ver} into “${ns}”?`)) return;
    /* Your existing backend call remains the same ----------------------- */
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
        userValuesYaml: vals
      })
    });
    setBusy(false);
    alert("Deploy sent!");
    onBack();
  }

  /* -------------------------------------------------------------------- */
  return (
    <>
      <button className="btn-secondary btn-back" onClick={onBack}>← Back</button>
      <h2>{chart.displayName || chart.name}</h2>

      <label>Version</label>
      {versions.length ? (
        <select value={ver} onChange={e => setVer(e.target.value)}>
          {versions.map(v => <option key={v}>{v}</option>)}
        </select>
      ) : (
        <em>no versions found</em>
      )}

      <label style={{ marginTop: "1rem" }}>Namespace</label>
      <input value={ns} onChange={e => setNs(e.target.value)} />

      {busy ? (
        <div className="editor-placeholder"><Spinner size={36} /></div>
      ) : (
        <div ref={editorRef} className="editor-frame" />
      )}

      <button className="btn" onClick={submit} disabled={busy || !ver}>
        {busy ? "Loading…" : "Install"}
      </button>
    </>
  );
}
