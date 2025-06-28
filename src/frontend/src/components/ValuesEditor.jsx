import React, { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import Spinner from "./Spinner.jsx";

/* ── derive the Artifact Hub repo slug (“owner”) ─────────────────────────── */
function getOwner(c) {
  if (c.repoName) return c.repoName;

  try {
    const u      = new URL(c.repo || "");
    const parts  = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    if (parts.length) return parts.pop();
    return u.hostname.split(".")[0] || "unknown";
  } catch {
    return "unknown";
  }
}

export default function ValuesEditor({ chart, onBack }) {
  const owner = getOwner(chart);

  /* we already know the version → no extra /versions call */
  const [versions] = useState([chart.version]);
  const [ver, setVer] = useState(chart.version);

  const [ns,   setNs ] = useState(chart.name);
  const [vals, setVals] = useState("");
  const [busy, setBusy] = useState(true);
  const ref = useRef(null);

  /* ① fetch default values.yaml once -------------------------------------- */
  useEffect(() => {
    setBusy(true);
    fetch(`/api/chart/values?owner=${owner}&chart=${chart.name}&ver=${ver}`)
      .then(r => r.text())
      .then(txt => {
        setVals(txt);
        setBusy(false);
      });
  }, [chart, owner, ver]);

  /* ② mount Monaco --------------------------------------------------------- */
  useEffect(() => {
    if (busy || !ref.current) return;
    const ed = monaco.editor.create(ref.current, {
      value: vals,
      language: "yaml",
      automaticLayout: true,
      minimap: { enabled: false }
    });
    ed.onDidChangeModelContent(() => setVals(ed.getValue()));
    return () => ed.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  /* ③ submit --------------------------------------------------------------- */
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

  /* ── UI ─────────────────────────────────────────────────────────────────── */
  return (
    <>
      <button className="btn-secondary btn-back" onClick={onBack}>← Back</button>

      <h2>{chart.name}</h2>

      <label>Version</label>
      <select value={ver} onChange={e => setVer(e.target.value)}>
        {versions.map(v => <option key={v}>{v}</option>)}
      </select>

      <label style={{ marginTop: "1rem" }}>Namespace</label>
      <input value={ns} onChange={e => setNs(e.target.value)} />

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

      <button className="btn" onClick={submit} disabled={busy}>
        {busy ? "Loading…" : "Install"}
      </button>
    </>
  );
}
