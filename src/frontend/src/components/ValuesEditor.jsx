/*  ValuesEditor.jsx
    ───────────────────────────────────────────────────────────────
    “Install chart” flow – with an optional *friendly* UI that
    turns YAML into a graphical form (YamlTreeEditor).

    Key bits
      • Checkbox “Switch to Friendly User Experience”
      • FRIENDLY ON  → hides Monaco, shows YamlTreeEditor
      • Both editors can be maximised to full-screen
*/

import React, { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import yaml from "js-yaml";
import Spinner from "./Spinner.jsx";
import YamlTreeEditor from "./YamlTreeEditor.jsx";

/* ─── tiny fetch helpers ─────────────────────────────────────── */
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
      try { cb(await fetchSmart(url, { signal: ctrl.signal })); } catch {/* ignore */ }
    })();
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
const fmtDate = iso => {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toISOString().slice(0, 10);
};

/* ─────────────────────────────────────────────────────────────── */
export default function ValuesEditor({
  chart,
  installStyle = "name",
  onBack,
  onNotify = () => {},
}) {
  /* ───────────────── fixed style (no dropdown) ─────────────── */
  const style = installStyle === "trio" ? "trio" : "name";

  /* ───────────────── chart versions / defaults ─────────────── */
  const [versions, setVers] = useState([]);
  const [ver,      setVer ] = useState("");
  const [initVals, setInit] = useState("");
  const [busy,     setBusy] = useState(true);

  /* ───────────────── form inputs ────────────────────────────── */
  const [name,    setName ] = useState(chart.name); // style=name
  const [team,    setTeam ] = useState("");         // style=trio
  const [env,     setEnv  ] = useState("");
  const [appCode, setCode ] = useState("");

  /* ───────────────── misc state ─────────────────────────────── */
  const [preview,      setPre ]    = useState(null);   // { delta } | null
  const [downloadOnly, setDL  ]    = useState(false);
  const [full,         setFull]    = useState(false);  // Monaco full-screen
  const [friendly,     setFr  ]    = useState(false);  // friendly ON / OFF
  const [treeFull,     setTFull]   = useState(false);  // Tree full-screen

  /*  friendly YAML mirror  */
  const [treeYaml, setTreeYaml] = useState("");

  /* ───────────────── monaco refs ────────────────────────────── */
  const edDivRef = useRef(null);
  const edRef    = useRef(null);
  const ymlRef   = useRef("");

  /* ─── fetch versions once ─────────────────────────────────── */
  useFetch(
    `/api/chart/versions?owner=${encodeURIComponent(chart.repoName)}&chart=${encodeURIComponent(chart.name)}`,
    [chart.name, chart.repoName],
    (arr = []) => { setVers(arr); setVer(arr[0]?.version || ""); },
  );

  /* ─── fetch default values whenever version changes ───────── */
  useEffect(() => {
    if (!ver) return;
    let cancelled = false;

    (async () => {
      setBusy(true);
      try {
        const yml = await fetchSmart(
          `/api/chart/values?pkgId=${chart.packageId}&version=${ver}`,
        );
        if (!cancelled) {
          setInit(yml); ymlRef.current = yml; setBusy(false);
          if (friendly) setTreeYaml(yml);
        }
      } catch {
        if (!cancelled) {
          const msg = "# (no default values found)";
          setInit(msg); ymlRef.current = msg; setBusy(false);
          if (friendly) setTreeYaml(msg);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [chart.packageId, ver, friendly]);

  /* ─── mount Monaco once ───────────────────────────────────── */
  useEffect(() => {
    if (busy || !edDivRef.current || edRef.current || friendly) return;
    edRef.current = monaco.editor.create(edDivRef.current, {
      value           : initVals,
      language        : "yaml",
      automaticLayout : true,
      minimap         : { enabled: false },
    });
    edRef.current.onDidChangeModelContent(() => {
      ymlRef.current = edRef.current.getValue();
    });
    return () => edRef.current?.dispose();
  }, [busy, initVals, friendly]);

  /* ─── keep Monaco layout fresh after modals close ─────────── */
  useEffect(() => { if (!preview && edRef.current) edRef.current.layout(); }, [preview]);
  useEffect(() => { if (!full && edRef.current) { edRef.current.setValue(ymlRef.current); edRef.current.layout(); } }, [full]);

  /* ────────────────────────────────────────────────────────────
     Helpers (preview Δ  /  deploy  /  Monaco-full)
     ─────────────────────────────────────────────────────────── */
  async function openPreview() {
    if (downloadOnly) { deploy(""); return; }
    setBusy(true);
    try {
      const delta = await fetchSmart("/api/delta", {
        method  : "POST",
        headers : { "Content-Type": "application/json" },
        body    : JSON.stringify({ defaultYaml: initVals, userYaml: ymlRef.current }),
      });
      setPre({ delta });
    } catch (e) {
      console.error("Δ-preview failed:", e);
      onNotify("error", "Unable to compute YAML delta.", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function deploy(deltaOverride) {
    const deltaStr =
      (deltaOverride ?? (preview?.delta || "").trim()) || "# (no overrides)";

    /* derive identifiers */
    let release, namespace, extra = {};
    if (style === "name") {
      release   = name.trim() || chart.name;
      namespace = release;
      extra     = { name: release };
    } else {
      release   = appCode.trim();
      namespace = [team.trim(), env.trim(), appCode.trim()].filter(Boolean).join("-");
      extra     = { applicationCode: appCode.trim(), team: team.trim(), env: env.trim() };
    }

    const base = {
      chart  : chart.name,
      version: ver,
      repo   : chart.repoURL,
      owner  : chart.repoName,
      release,
      namespace,
    };

    const payload = downloadOnly
      ? { ...base, ...extra }
      : {
          ...base,
          ...extra,
          userValuesYaml: deltaStr === "# (no overrides)"
            ? ""
            : btoa(unescape(encodeURIComponent(deltaStr))),
        };

    const endpoint = downloadOnly ? "/api/download" : "/api/apps";

    setBusy(true);
    let ok = true;
    try {
      const resp = await fetch(endpoint, {
        method  : "POST",
        headers : { "Content-Type": "application/json" },
        body    : JSON.stringify(payload),
      });
      if (!resp.ok) {
        ok = false;
        throw new Error(`HTTP ${resp.status}`);
      }
    } catch (e) {
      console.error("deploy error:", e);
      onNotify("error", downloadOnly ? "Download request failed." : "Install request failed.", e.message);
      setBusy(false);
      return;
    }
    setBusy(false);

    if (ok) {
      onNotify(
        "success",
        downloadOnly ? "Download request sent!" : "Install request sent!",
        release
      );
    }
    onBack();
  }

  /* ────────────────────────────────────────────────────────────
     Full-screen helpers
     ─────────────────────────────────────────────────────────── */
  function FullscreenEditor() {
    const ref = useRef(null);
    useEffect(() => {
      if (!ref.current) return;
      const e = monaco.editor.create(ref.current, {
        value           : ymlRef.current,
        language        : "yaml",
        automaticLayout : true,
        minimap         : { enabled: false },
      });
      e.onDidChangeModelContent(() => { ymlRef.current = e.getValue(); });

      const esc = ev => { if (ev.key === "Escape") setFull(false); };
      window.addEventListener("keydown", esc);

      return () => {
        ymlRef.current = e.getValue();
        edRef.current?.setValue(ymlRef.current);
        edRef.current?.layout();
        e.dispose();
        window.removeEventListener("keydown", esc);
      };
    }, []);

    return (
      <div className="modal-overlay" onClick={() => setFull(false)}>
        <div className="modal-dialog" style={{ width: "90vw", height: "90vh", padding: 0 }}
             onClick={e => e.stopPropagation()}>
          <button className="modal-close" onClick={() => setFull(false)}>×</button>
          <div ref={ref} style={{ width: "100%", height: "100%" }} />
        </div>
      </div>
    );
  }

  function FullTreeModal() {
    const esc = ev => { if (ev.key === "Escape") setTFull(false); };
    useEffect(() => { window.addEventListener("keydown", esc);
      return () => window.removeEventListener("keydown", esc); }, []);
    return (
      <div className="modal-overlay" onClick={() => setTFull(false)}>
        <div className="modal-dialog" style={{ width: "90vw", height: "90vh", padding: 0 }}
             onClick={e => e.stopPropagation()}>
          <button className="modal-close" onClick={() => setTFull(false)}>×</button>
          <YamlTreeEditor
            yamlText={treeYaml}
            onChange={txt => { setTreeYaml(txt); ymlRef.current = txt; }}
          />
        </div>
      </div>
    );
  }

  /* ────────────────────────────────────────────────────────────
     Header helpers (unchanged)
     ─────────────────────────────────────────────────────────── */
  function ChartHeader() {
    return (
      <div style={{ display: "flex", alignItems: "flex-start", gap: "1rem", marginBottom: "1.1rem" }}>
        {chart.logo && (
          <img src={chart.logo} alt=""
               style={{ width: 48, height: 48, borderRadius: 6,
                        objectFit: "contain", background: "#fff", flexShrink: 0 }} />
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

  /* ───────────────── ready checks ───────────────────────────── */
  const namesOk =
    style === "name"
      ? Boolean(name.trim())
      : team.trim() && env.trim() && appCode.trim();

  /* ────────────────────────────────────────────────────────────
     RENDER
     ─────────────────────────────────────────────────────────── */
  return (
    <>
      {preview   && <PreviewModal />}
      {full      && <FullscreenEditor />}
      {treeFull  && <FullTreeModal />}

      <button className="btn-secondary btn-back" onClick={onBack}>← Back</button>
      <ChartHeader />

      {/* version select */}
      <label>Version</label>
      {versions.length ? (
        <select value={ver} onChange={e => setVer(e.target.value)}>
          {versions.map(v => (
            <option key={v.version} value={v.version}>
              {v.version}{v.date ? `  –  ${fmtDate(v.date)}` : ""}
            </option>
          ))}
        </select>
      ) : <em>no versions found</em>}

      {/* identifiers */}
      {style === "name" ? (
        <>
          <label style={{ marginTop: "1rem" }}>Application name</label>
          <input value={name} onChange={e => setName(e.target.value)}
                 style={{ width: "100%", padding: ".55rem .8rem" }}
                 placeholder="e.g. grafana" />
        </>
      ) : (
        <>
          <label style={{ marginTop: "1rem" }}>Team</label>
          <input value={team} onChange={e => setTeam(e.target.value)}
                 style={{ width: "100%", padding: ".55rem .8rem" }}
                 placeholder="e.g. alcasys" />
          <label style={{ marginTop: "1rem" }}>Environment</label>
          <input value={env} onChange={e => setEnv(e.target.value)}
                 style={{ width: "100%", padding: ".55rem .8rem" }}
                 placeholder="e.g. ppt" />
          <label style={{ marginTop: "1rem" }}>Application code</label>
          <input value={appCode} onChange={e => setCode(e.target.value)}
                 style={{ width: "100%", padding: ".55rem .8rem" }}
                 placeholder="e.g. wfm" />
        </>
      )}

      {/* download-only toggle */}
      <label style={{ marginTop: "1rem", display: "flex", gap: ".5rem" }}>
        <input type="checkbox" checked={downloadOnly}
               onChange={e => setDL(e.target.checked)}
               style={{ transform: "translateY(2px)" }} />
        <span>I only want to download this Helm chart (do not install)</span>
      </label>

      {/* friendly mode toggle */}
      {!downloadOnly && (
        <label style={{ marginTop: ".6rem", display: "flex", gap: ".5rem" }}>
          <input type="checkbox" checked={friendly}
                 onChange={e => {
                   const checked = e.target.checked;
                   if (checked) setTreeYaml(ymlRef.current);
                   else {
                     ymlRef.current = treeYaml;
                     edRef.current?.setValue(ymlRef.current);
                   }
                   setFr(checked);
                 }}
                 style={{ transform: "translateY(2px)" }} />
          <span>Switch to Friendly User Experience</span>
        </label>
      )}

      {/* EDITOR AREA ------------------------------------------------ */}      
      {!downloadOnly && (
        busy ? (
          <div style={{
            height: "52vh", display: "flex", alignItems: "center",
            justifyContent: "center"
          }}><Spinner size={36} /></div>
        ) : friendly ? (
          <div style={{ position: "relative" }}>
            <button className="btn-secondary"
                    style={{
                      position: "absolute", top: 6, right: 6,
                      padding: ".25rem .6rem", fontSize: ".8rem",
                      zIndex: 5
                    }}
                    onClick={() => setTFull(true)}>
              ⤢ Full screen
            </button>
            <YamlTreeEditor yamlText={treeYaml}
                            onChange={txt => { setTreeYaml(txt); ymlRef.current = txt; }} />
          </div>
        ) : (
          <div style={{ position: "relative" }}>
            <button className="btn-secondary"
                    style={{
                      position: "absolute", top: 6, right: 6,
                      padding: ".25rem .6rem", fontSize: ".8rem",
                      zIndex: 5
                    }}
                    onClick={() => setFull(true)}>
              ⤢ Full screen
            </button>
            <div ref={edDivRef} className="editor-frame" />
          </div>
        )
      )}

      {/* primary action */}
      <button className="btn" onClick={openPreview}
              disabled={busy || !ver || !namesOk}>
        {busy ? "Working…" : downloadOnly ? "Download chart" : "Install"}
      </button>
    </>
  );

  /* ────────────────────────────────────────────────────────────
     Preview modal (unchanged apart from alert→onNotify)
     ─────────────────────────────────────────────────────────── */
  function PreviewModal() {
    const mRef = useRef(null);
    useEffect(() => {
      if (!mRef.current) return;
      const e = monaco.editor.create(mRef.current, {
        value           : preview?.delta || "# (no overrides)",
        language        : "yaml",
        readOnly        : true,
        automaticLayout : true,
        minimap         : { enabled: false },
      });
      return () => e.dispose();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return (
      <div className="modal-overlay" onClick={() => setPre(null)}>
        <div className="modal-dialog" style={{ width: "64vw", maxWidth: 900 }}
             onClick={e => e.stopPropagation()}>
          <button className="modal-close" onClick={() => setPre(null)}>×</button>
          <h2 style={{ margin: 0 }}>Override values preview</h2>
          <p style={{ margin: ".65rem 0 1rem", fontSize: ".85rem",
                      color: "var(--text-light)" }}>
            Only the keys that differ from chart defaults will be saved.
          </p>
          <div ref={mRef}
               style={{ height: "50vh", border: "1px solid var(--border)",
                        borderRadius: 6 }} />
          <div style={{
            display: "flex", gap: "1rem", justifyContent: "flex-end",
            marginTop: "1.1rem"
          }}>
            <button className="btn-secondary" onClick={() => setPre(null)}
                    disabled={busy}>Back</button>
            <button className="btn" onClick={() => deploy()}
                    disabled={busy}>{busy ? "Saving…" : "Install"}</button>
          </div>
        </div>
      </div>
    );
  }
}
