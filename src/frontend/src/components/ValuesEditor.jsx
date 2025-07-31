/*  ValuesEditor.jsx
    ───────────────────────────────────────────────────────────────
    “Install chart” flow – supports:

      • Plain YAML editing with Monaco
      • Friendly form editing (YamlTreeEditor)
      • Download-only mode (no identifiers required)  ← FIXED ✨
      • Full-screen editors
*/

import React, { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import yaml from "js-yaml";               // (still used by YamlTreeEditor)
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
      try { cb(await fetchSmart(url, { signal: ctrl.signal })); } catch {/* ignore */}
    })();
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
const fmtDate = (iso) => {
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
  /* ───────── fixed style (cluster-wide convention) ─────────── */
  const style = installStyle === "trio" ? "trio" : "name";

  /* ───────── chart versions & defaults ─────────────────────── */
  const [versions, setVers] = useState([]);
  const [ver, setVer]       = useState("");
  const [initVals, setInit] = useState("");
  const [busy, setBusy]     = useState(true);

  /* ───────── identifiers (name style / trio style) ─────────── */
  const [name,    setName ] = useState(chart.name);
  const [team,    setTeam ] = useState("");
  const [env,     setEnv  ] = useState("");
  const [appCode, setCode ] = useState("");

  /* ───────── misc state ────────────────────────────────────── */
  const [preview,   setPre ]  = useState(null);   // { delta }
  const [downloadOnly, setDL] = useState(false);  // ← new logic depends on this
  const [friendly, setFr]     = useState(false);
  const [full,   setFull]     = useState(false);  // Monaco FS
  const [treeFS, setTFS]      = useState(false);  // Tree FS

  /* UI-state mirrors */
  const [treeYaml, setTreeYaml] = useState("");

  /* ───────── refs ──────────────────────────────────────────── */
  const edDivRef = useRef(null);   // mount point for Monaco
  const edRef    = useRef(null);   // Monaco instance
  const ymlRef   = useRef("");     // current YAML text

  /* ════════════════════════════════════════════════════════════
     1.  Fetch chart versions once
     ═══════════════════════════════════════════════════════════ */
  useFetch(
    `/api/chart/versions?owner=${encodeURIComponent(chart.repoName)}&chart=${encodeURIComponent(chart.name)}`,
    [chart.name, chart.repoName],
    (arr = []) => {
      setVers(arr);
      setVer(arr[0]?.version || "");
    },
  );

  /* ════════════════════════════════════════════════════════════
     2.  Fetch default values whenever version changes
     ═══════════════════════════════════════════════════════════ */
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
          setInit(yml);
          ymlRef.current = yml;
          if (friendly) setTreeYaml(yml);
        }
      } catch {
        if (!cancelled) {
          const msg = "# (no default values found)";
          setInit(msg);
          ymlRef.current = msg;
          if (friendly) setTreeYaml(msg);
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => { cancelled = true; };
  }, [chart.packageId, ver, friendly]);

  /* ════════════════════════════════════════════════════════════
     3.  Create / dispose Monaco depending on visibility
     ═══════════════════════════════════════════════════════════ */
  useEffect(() => {
    const visible = !busy && !downloadOnly && !friendly;

    /* dispose if should be hidden */
    if (!visible && edRef.current) {
      ymlRef.current = edRef.current.getValue();   // preserve edits
      edRef.current.dispose();
      edRef.current = null;
    }

    /* create if visible & not yet created */
    if (visible && edDivRef.current && !edRef.current) {
      edRef.current = monaco.editor.create(edDivRef.current, {
        value           : ymlRef.current || initVals,
        language        : "yaml",
        automaticLayout : true,
        minimap         : { enabled: false },
      });
      edRef.current.onDidChangeModelContent(() => {
        ymlRef.current = edRef.current.getValue();
      });
    }

    /* repaint every time we (re)show it */
    if (visible && edRef.current) edRef.current.layout();
  }, [busy, downloadOnly, friendly, initVals]);

  /* ════════════════════════════════════════════════════════════
     4.  Helpers (preview Δ and deploy)
     ═══════════════════════════════════════════════════════════ */
  async function openPreview() {
    /* For download-only there is nothing to diff – jump straight to deploy */
    if (downloadOnly) { deploy(); return; }

    setBusy(true);
    try {
      const delta = await fetchSmart("/api/delta", {
        method  : "POST",
        headers : { "Content-Type": "application/json" },
        body    : JSON.stringify({ defaultYaml: initVals, userYaml: ymlRef.current }),
      });
      setPre({ delta });
    } catch (e) {
      console.error("Δ-preview error:", e);
      onNotify("error", "Unable to compute YAML delta.", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function deploy() {
    /* ── build payload ───────────────────────────────────────── */
    let payload;
    if (downloadOnly) {
      /* Download-only needs just four fields */
      payload = {
        chart  : chart.name,
        version: ver,
        repo   : chart.repoURL,
        owner  : chart.repoName,
      };
    } else {
      /* Regular install needs identifiers + optional delta YAML */
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

      const deltaStr = (preview?.delta || "").trim() || "# (no overrides)";
      payload = {
        chart   : chart.name,
        version : ver,
        repo    : chart.repoURL,
        owner   : chart.repoName,
        release,
        namespace,
        ...extra,
        userValuesYaml:
          deltaStr === "# (no overrides)" ? "" :
          btoa(unescape(encodeURIComponent(deltaStr))),
      };
    }

    const endpoint = downloadOnly ? "/api/download" : "/api/apps";

    setBusy(true);
    try {
      const resp = await fetch(endpoint, {
        method : "POST",
        headers: { "Content-Type": "application/json" },
        body   : JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      onNotify(
        "success",
        downloadOnly ? "Download request sent!" : "Install request sent!",
        chart.name,
      );
      onBack();
    } catch (e) {
      console.error("deploy error:", e);
      onNotify(
        "error",
        downloadOnly ? "Download request failed." : "Install request failed.",
        e.message,
      );
    } finally { setBusy(false); }
  }


  /* ════════════════════════════════════════════════════════════
     5.  Full‑screen helpers (Monaco & Tree)
     ═══════════════════════════════════════════════════════════ */
  function FullscreenEditor() {
    const ref = useRef(null);
    useEffect(() => {
      const e = monaco.editor.create(ref.current, {
        value : ymlRef.current,
        language: "yaml",
        automaticLayout: true,
        minimap: { enabled: false },
      });
      e.onDidChangeModelContent(() => { ymlRef.current = e.getValue(); });

      const esc = ev => { if (ev.key === "Escape") setFull(false); };
      window.addEventListener("keydown", esc);
      return () => {
        ymlRef.current = e.getValue();
        window.removeEventListener("keydown", esc);
        e.dispose();
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
    const esc = ev => { if (ev.key === "Escape") setTFS(false); };
    useEffect(() => { window.addEventListener("keydown", esc);
      return () => window.removeEventListener("keydown", esc); }, []);
    return (
      <div className="modal-overlay" onClick={() => setTFS(false)}>
        <div className="modal-dialog" style={{ width: "90vw", height: "90vh", padding: 0 }}
             onClick={e => e.stopPropagation()}>
          <button className="modal-close" onClick={() => setTFS(false)}>×</button>
          <YamlTreeEditor
            yamlText={treeYaml}
            onChange={txt => { setTreeYaml(txt); ymlRef.current = txt; }}
          />
        </div>
      </div>
    );
  }

  /* ════════════════════════════════════════════════════════════
     6.  Render helpers
     ═══════════════════════════════════════════════════════════ */
  const namesOk = downloadOnly
    ? true                                       // ← identifiers not needed
    : style === "name"
        ? Boolean(name.trim())
        : team.trim() && env.trim() && appCode.trim();

  function ChartHeader() {
    return (
      <div style={{ display: "flex", alignItems: "flex-start", gap: "1rem", marginBottom: "1.1rem" }}>
        {chart.logo && (
          <img
            src={chart.logo}
            alt=""
            style={{
              width: 48, height: 48, borderRadius: 6,
              objectFit: "contain", background: "#fff", flexShrink: 0 }}
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
            <p style={{ margin: ".45rem 0 0", fontSize: ".9rem",
                        color: "var(--text-light)", maxWidth: "60ch" }}>
              {chart.description}
            </p>
          )}
        </div>
      </div>
    );
  }

  /* ════════════════════════════════════════════════════════════
     7.  JSX
     ═══════════════════════════════════════════════════════════ */
  return (
    <>
      {preview && <PreviewModal />}
      {full    && <FullscreenEditor />}
      {treeFS  && <FullTreeModal />}

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

      {/* identifiers – hidden when “download only” is on */}
      {!downloadOnly && (
        style === "name" ? (
          <>
            <label style={{ marginTop: "1rem" }}>Application name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              style={{ width: "100%", padding: ".55rem .8rem" }}
              placeholder="e.g. grafana"
            />
          </>
        ) : (
          <>
            <label style={{ marginTop: "1rem" }}>Team</label>
            <input
              value={team}
              onChange={e => setTeam(e.target.value)}
              style={{ width: "100%", padding: ".55rem .8rem" }}
              placeholder="e.g. alcasys"
            />
            <label style={{ marginTop: "1rem" }}>Environment</label>
            <input
              value={env}
              onChange={e => setEnv(e.target.value)}
              style={{ width: "100%", padding: ".55rem .8rem" }}
              placeholder="e.g. ppt"
            />
            <label style={{ marginTop: "1rem" }}>Application code</label>
            <input
              value={appCode}
              onChange={e => setCode(e.target.value)}
              style={{ width: "100%", padding: ".55rem .8rem" }}
              placeholder="e.g. wfm"
            />
          </>
        )
      )}

      {/* download-only toggle */}
      <label style={{ marginTop: "1rem", display: "flex", gap: ".5rem" }}>
        <input
          type="checkbox"
          checked={downloadOnly}
          onChange={e => setDL(e.target.checked)}
          style={{ transform: "translateY(2px)" }}
        />
        <span>I only want to download this Helm chart (do not install)</span>
      </label>

      {/* friendly mode toggle */}
      {!downloadOnly && (
        <label style={{ marginTop: ".6rem", display: "flex", gap: ".5rem" }}>
          <input
            type="checkbox"
            checked={friendly}
            onChange={e => {
              const on = e.target.checked;
              if (on) {
                setTreeYaml(ymlRef.current);          // feed the tree
              } else {
                ymlRef.current = treeYaml;            // feed Monaco later
              }
              setFr(on);
            }}
            style={{ transform: "translateY(2px)" }}
          />
          <span>Switch to Friendly User Experience</span>
        </label>
      )}

      {/* editor area */}
      {!downloadOnly && (
        busy ? (
          <div style={{
            height: "52vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}>
            <Spinner size={36} />
          </div>
        ) : friendly ? (
          <div style={{ position: "relative" }}>
            <button
              className="btn-secondary"
              style={{
                position: "absolute",
                top: 6,
                right: 6,
                padding: ".25rem .6rem",
                fontSize: ".8rem",
                zIndex: 5,
              }}
              onClick={() => setTFS(true)}
            >
              ⤢ Full screen
            </button>
            <YamlTreeEditor
              yamlText={treeYaml}
              onChange={txt => { setTreeYaml(txt); ymlRef.current = txt; }}
            />
          </div>
        ) : (
          <div style={{ position: "relative" }}>
            <button
              className="btn-secondary"
              style={{
                position: "absolute",
                top: 6,
                right: 6,
                padding: ".25rem .6rem",
                fontSize: ".8rem",
                zIndex: 5,
              }}
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
        disabled={busy || !ver || !namesOk}
      >
        {busy ? "Working…" : downloadOnly ? "Download chart" : "Install"}
      </button>
    </>
  );

  /* ════════════════════════════════════════════════════════════
     8.  Preview modal – unchanged
     ═══════════════════════════════════════════════════════════ */
  function PreviewModal() {
    const mRef = useRef(null);
    useEffect(() => {
      const ed = monaco.editor.create(mRef.current, {
        value : preview?.delta || "# (no overrides)",
        language        : "yaml",
        readOnly        : true,
        automaticLayout : true,
        minimap         : { enabled: false },
      });
      return () => ed.dispose();
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
          <div ref={mRef} style={{
            height: "50vh", border: "1px solid var(--border)", borderRadius: 6 }} />
          <div style={{ display: "flex", gap: "1rem",
                        justifyContent: "flex-end", marginTop: "1.1rem" }}>
            <button className="btn-secondary" onClick={() => setPre(null)}
                    disabled={busy}>Back</button>
            <button className="btn" onClick={() => deploy()}
                    disabled={busy}>
              {busy ? "Saving…" : "Install"}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
