import React, { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import yaml         from "js-yaml";
import Spinner      from "./Spinner.jsx";

/* ------------------------------------------------------------------ */
/* generic fetch helper that auto-chooses .json() or .text()          */
async function fetchSmart(url, { signal } = {}) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  return ct.includes("json") ? res.json() : res.text();
}

/* small effect wrapper with abort-on-unmount                         */
function useFetch(url, deps, cb) {
  useEffect(() => {
    if (!url) return;
    const ctrl = new AbortController();
    (async () => {
      try { cb(await fetchSmart(url, { signal: ctrl.signal })); }
      catch {/* ignore – caller decides what to do */}
    })();
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
/* ------------------------------------------------------------------ */

export default function ValuesEditor({ chart, onBack }) {
  const [versions, setVers] = useState([]);
  const [ver,      setVer ] = useState("");
  const [vals,     setVals] = useState("");
  const [ns,       setNs ]  = useState(chart.name);
  const [busy,     setBusy] = useState(true);
  const editorRef  = useRef(null);

  /* ① load version list via backend proxy (no CORS!) ------------------- */
  useFetch(
    `/api/chart/versions?owner=${chart.repoName}&chart=${chart.name}`,
    [chart.repoName, chart.name],
    (arr = []) => {
      setVers(arr);
      setVer(arr[0] || "");
      setBusy(false);
    },
  );

  /* ② load default values every time the version changes --------------- */
  useEffect(() => {
    if (!ver) return;
    let done = false;
    (async () => {
      setBusy(true);

      /* try Artifact Hub’s /values endpoint – MAY fail on CORS ---------- */
      try {
        const yml = await fetchSmart(
          `https://artifacthub.io/api/v1/packages/${chart.packageId}/${ver}/values`,
        );
        if (!done) { setVals(yml); setBusy(false); return; }
      } catch {/* (ignore and fall back) */ }

      /* fall back to /templates + stringify ----------------------------- */
      try {
        const tpl = await fetchSmart(
          `https://artifacthub.io/api/v1/packages/${chart.packageId}/${ver}/templates`,
        );
        const yml = yaml.dump(tpl.values || {}, { lineWidth: 0 });
        if (!done) { setVals(yml); setBusy(false); }
      } catch (err) {
        console.error("Unable to obtain chart values:", err);
        if (!done) { setVals("# (no default values found)"); setBusy(false); }
      }
    })();
    return () => { done = true; };
  }, [chart.packageId, ver]);

  /* ③ mount Monaco once we have something to show ---------------------- */
  useEffect(() => {
    if (busy || !editorRef.current) return;
    const ed = monaco.editor.create(editorRef.current, {
      value: vals,
      language: "yaml",
      automaticLayout: true,
      minimap: { enabled: false },
    });
    ed.onDidChangeModelContent(() => setVals(ed.getValue()));
    return () => ed.dispose();
  }, [busy, vals]);

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
        userValuesYaml: vals,
      }),
    });
    setBusy(false);
    alert("Deploy sent!");
    onBack();
  }

  /* ⑤ render ----------------------------------------------------------- */
  return (
    <>
      <button className="btn-secondary btn-back" onClick={onBack}>
        ← Back
      </button>
      <h2>{chart.displayName || chart.name}</h2>

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

      <label style={{ marginTop: "1rem" }}>Namespace</label>
      <input value={ns} onChange={(e) => setNs(e.target.value)} />

      {busy ? (
        <div className="editor-placeholder">
          <Spinner size={36} />
        </div>
      ) : (
        <div ref={editorRef} className="editor-frame" />
      )}

      <button className="btn" onClick={submit} disabled={busy || !ver}>
        {busy ? "Loading…" : "Install"}
      </button>
    </>
  );
}
