import React, { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import Spinner from "./Spinner.jsx";

/* --------------------------------------------------------------------------
   Helper that derives the correct Artifact Hub “owner” (repository slug):
   1) Prefer the repoName we stored in ChartSearch.jsx.
   2) Otherwise fall back to guessing it from the repo URL.
---------------------------------------------------------------------------- */
function getOwner(c) {
  if (c.repoName) return c.repoName;                 // best case

  try {
    const u      = new URL(c.repo || "");
    const parts  = u.pathname.replace(/\/+$/, "")    // trim trailing “/”
                       .split("/")
                       .filter(Boolean);

    /* 👇  typical patterns
       ├─ https://grafana.github.io/helm-charts      → helm-charts  (bad)
       ├─ https://charts.bitnami.com/bitnami         → bitnami      (good)
       └─ https://my.corp.local/helm/foo             → foo          (good)
    */
    if (parts.length) return parts.pop();

    /* finally, use the host minus dots: grafana.github.io → grafana */
    return u.hostname.split(".")[0] || "unknown";
  } catch {
    return "unknown";
  }
}

export default function ValuesEditor({ chart, onBack }) {
  const owner = getOwner(chart);

  const [versions, setVers] = useState([]);
  const [ver,      setVer ] = useState("");
  const [ns,       setNs ]  = useState(chart.name);   // default = chart name
  const [vals,     setVals] = useState("");
  const [busy,     setBusy] = useState(true);

  const ref = useRef(null);

  /* ① fetch version list once ----------------------------------- */
  useEffect(() => {
    fetch(`/api/chart/versions?owner=${owner}&chart=${chart.name}`)
      .then(r => r.json())
      .then(vs => {
        setVers(vs);
        setVer(vs[0] || "");
      });
  }, [chart, owner]);

  /* ② load default values whenever version changes -------------- */
  useEffect(() => {
    if (!ver) return;
    setBusy(true);
    fetch(`/api/chart/values?owner=${owner}&chart=${chart.name}&ver=${ver}`)
      .then(r => r.text())
      .then(txt => {
        setVals(txt);
        setBusy(false);
      });
  }, [ver, chart, owner]);

  /* ③ mount Monaco once ----------------------------------------- */
  useEffect(() => {
    if (!ref.current) return;
    const ed = monaco.editor.create(ref.current, {
      value: vals,
      language: "yaml",
      automaticLayout: true,
      minimap: { enabled: false }
    });
    ed.onDidChangeModelContent(() => setVals(ed.getValue()));
    return () => ed.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]); // re-mount when values first arrive

  /* ④ submit ----------------------------------------------------- */
  async function submit() {
    if (!window.confirm(`Deploy ${chart.name}@${ver} into "${ns}"?`)) return;
    setBusy(true);
    await fetch("/api/apps", {
      method : "POST",
      headers: { "Content-Type": "application/json" },
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
      <button className="btn-secondary btn-back" onClick={onBack}>
        ← Back
      </button>

      <h2>{chart.name}</h2>

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

      <label style={{ marginTop: "1rem" }}>Namespace</label>
      <input value={ns} onChange={e => setNs(e.target.value)} />

      {/* values editor or spinner */}
      {busy ? (
        <div
          style={{
            height: "52vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}
        >
          <Spinner size={36} />
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
