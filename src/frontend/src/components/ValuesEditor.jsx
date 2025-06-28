import React, { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import Spinner from "./Spinner.jsx";

export default function ValuesEditor({ chart, onBack }) {
  const owner = (chart.repo || "").split("/").filter(Boolean).pop() || "unknown";

  const [versions, setVers] = useState([]);
  const [ver,      setVer ] = useState("");
  const [ns,       setNs ] = useState(chart.name);   // default = chart name
  const [vals,     setVals] = useState("");
  const [busy,     setBusy] = useState(true);

  const ref = useRef(null);

  /* ① fetch version list once ----------------------------------- */
  useEffect(() => {
    fetch(`/api/chart/versions?owner=${owner}&chart=${chart.name}`)
      .then(r => r.json())
      .then(vs => { setVers(vs); setVer(vs[0] || ""); });
  }, [chart]);

  /* ② load default values whenever version changes -------------- */
  useEffect(() => {
    if (!ver) return;
    setBusy(true);
    fetch(`/api/chart/values?owner=${owner}&chart=${chart.name}&ver=${ver}`)
      .then(r => r.text())
      .then(txt => { setVals(txt); setBusy(false); });
  }, [ver, chart]);

  /* ③ mount Monaco once ----------------------------------------- */
  useEffect(() => {
    if (!ref.current) return;
    const ed = monaco.editor.create(ref.current, {
      value: vals,
      language: "yaml",
      automaticLayout: true,
      minimap: { enabled:false }
    });
    ed.onDidChangeModelContent(() => setVals(ed.getValue()));
    return () => ed.dispose();
  }, [busy]);                         // remount when values first arrive

  /* ④ submit ----------------------------------------------------- */
  async function submit() {
    if (!window.confirm(`Deploy ${chart.name}@${ver} into "${ns}"?`)) return;
    setBusy(true);
    await fetch("/api/apps", {
      method : "POST",
      headers: { "Content-Type":"application/json" },
      body   : JSON.stringify({
        chart   : chart.name,
        repo    : chart.repo,
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

  return (
    <>
      <button className="btn-secondary btn-back" onClick={onBack}>← Back</button>

      <h2>{chart.name}</h2>

      {/* version selector */}
      <label>Version</label>
      {versions.length ? (
        <select value={ver} onChange={e => setVer(e.target.value)}>
          {versions.map(v => <option key={v}>{v}</option>)}
        </select>
      ) : (
        <em>no versions found</em>
      )}

      <label style={{ marginTop:"1rem" }}>Namespace</label>
      <input value={ns} onChange={e => setNs(e.target.value)} />

      {/* values editor or spinner */}
      {busy ? (
        <div style={{ height:"52vh", display:"flex", alignItems:"center", justifyContent:"center" }}>
          <Spinner size={36}/>
        </div>
      ) : (
        <div ref={ref} className="editor-frame" />
      )}

      <button className="btn" onClick={submit} disabled={busy || !ver}>
        {busy ? "Loading…" : "Install"}
      </button>
    </>
  );
}
