/*  ValuesEditor.jsx
    ───────────────────────────────────────────────────────────────
    “Install chart” flow – optionally switches to a *Friendly UX*
    graphical editor (YamlTreeEditor).

    Key points:
      • Auto-detected “name” vs. “trio” install styles
      • Toggle for download-only requests
      • Toggle for Friendly UX (graphical) – preserves scroll
      • Monaco full-screen mode
      • Δ-preview before install / upgrade
*/

import React, { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import Spinner from "./Spinner.jsx";
import YamlTreeEditor from "./YamlTreeEditor.jsx";
import yaml from "js-yaml";

/* ── helpers ─────────────────────────────────────────────────── */
async function fetchSmart(url, opts = {}) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const ct = r.headers.get("content-type") || "";
  return ct.includes("json") ? r.json() : r.text();
}
function useFetch(url, deps, cb) {
  useEffect(() => {
    if (!url) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetchSmart(url, { signal: ctrl.signal });
        cb(res);
      } catch {
        /* ignore */
      }
    })();
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
}) {
  /* static (install style) ------------------------------------ */
  const style = installStyle === "trio" ? "trio" : "name";

  /* chart versions / defaults --------------------------------- */
  const [versions, setVers] = useState([]);
  const [ver, setVer] = useState("");
  const [initVals, setInit] = useState("");
  const [busy, setBusy] = useState(true);

  /* form inputs ----------------------------------------------- */
  const [name, setName] = useState(chart.name); // style=name
  const [team, setTeam] = useState(""); // style=trio
  const [env, setEnv] = useState("");
  const [appCode, setCode] = useState("");

  /* toggles ---------------------------------------------------- */
  const [preview, setPre] = useState(null); // { delta } | null
  const [downloadOnly, setDL] = useState(false);
  const [full, setFull] = useState(false);
  const [friendly, setFr] = useState(false);

  /* friendly mode – latest YAML buffer ------------------------ */
  const [treeYaml, setTreeYaml] = useState("");

  /* monaco refs ------------------------------------------------ */
  const edDivRef = useRef(null);
  const edRef = useRef(null);
  const ymlRef = useRef("");

  /* fetch chart versions once --------------------------------- */
  useFetch(
    `/api/chart/versions?owner=${encodeURIComponent(
      chart.repoName,
    )}&chart=${encodeURIComponent(chart.name)}`,
    [chart.name, chart.repoName],
    (arr = []) => {
      setVers(arr);
      setVer(arr[0]?.version || "");
    },
  );

  /* fetch default values when version changes ----------------- */
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
          setBusy(false);
        }
      } catch {
        if (!cancelled) {
          const msg = "# (no default values found)";
          setInit(msg);
          ymlRef.current = msg;
          if (friendly) setTreeYaml(msg);
          setBusy(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chart.packageId, ver, friendly]);

  /* mount Monaco once ----------------------------------------- */
  useEffect(() => {
    if (busy || !edDivRef.current || edRef.current || friendly) return;
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
  }, [busy, initVals, friendly]);

  /* keep layout fresh ----------------------------------------- */
  useEffect(() => {
    if (!preview && edRef.current) edRef.current.layout();
  }, [preview]);
  useEffect(() => {
    if (!full && edRef.current) {
      edRef.current.setValue(ymlRef.current);
      edRef.current.layout();
    }
  }, [full]);

  /* full-screen Monaco editor --------------------------------- */
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

      const esc = ev => {
        if (ev.key === "Escape") setFull(false);
      };
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

  /* delta preview helper -------------------------------------- */
  async function openPreview() {
    if (downloadOnly) {
      deploy("");
      return;
    }
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

  /* install / download helper --------------------------------- */
  async function deploy(deltaOverride) {
    const deltaStr =
      (deltaOverride ?? (preview?.delta || "").trim()) || "# (no overrides)";

    /* derive identifiers */
    let release,
      namespace,
      extra = {};
    if (style === "name") {
      release = name.trim() || chart.name;
      namespace = release;
      extra = { name: release };
    } else {
      release = appCode.trim();
      namespace = [team.trim(), env.trim(), appCode.trim()]
        .filter(Boolean)
        .join("-");
      extra = {
        applicationCode: appCode.trim(),
        team: team.trim(),
        env: env.trim(),
      };
    }

    const base = {
      chart: chart.name,
      version: ver,
      repo: chart.repoURL,
      owner: chart.repoName,
      release,
      namespace,
    };

    const payload = downloadOnly
      ? { ...base, ...extra }
      : {
          ...base,
          ...extra,
          userValuesYaml:
            deltaStr === "# (no overrides)"
              ? ""
              : btoa(unescape(encodeURIComponent(deltaStr))),
        };

    const endpoint = downloadOnly ? "/api/download" : "/api/apps";

    setBusy(true);
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);

    alert(downloadOnly ? "Download request sent!" : "Install request sent!");
    onBack();
  }

  /* preview modal (unchanged) --------------------------------- */
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
          <p
            style={{
              margin: "0 0 1rem",
              fontSize: ".85rem",
              color: "var(--text-light)",
            }}
          >
            Only the keys that differ from chart defaults will be saved.
          </p>
          <div
            ref={mRef}
            style={{
              height: "50vh",
              border: "1px solid var(--border)",
              borderRadius: 6,
            }}
          />
          <div
            style={{
              display: "flex",
              gap: "1rem",
              justifyContent: "flex-end",
              marginTop: "1.1rem",
            }}
          >
            <button
              className="btn-secondary"
              onClick={() => setPre(null)}
              disabled={busy}
            >
              Back
            </button>
            <button className="btn" onClick={() => deploy()} disabled={busy}>
              {busy ? "Saving…" : "Install"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* header helper --------------------------------------------- */
  function ChartHeader() {
    return (
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
          <h2 style={{ margin: 0 }}>{chart.displayName || chart.name}</h2>
          {chart.repoName && (
            <p
              style={{
                margin: ".1rem 0 0",
                fontSize: ".83rem",
                color: "var(--text-light)",
              }}
            >
              {chart.repoName}
              {chart.latest ? ` · latest ${chart.latest}` : ""}
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
    );
  }

  /* readiness checks ------------------------------------------ */
  const namesOk =
    style === "name"
      ? Boolean(name.trim())
      : team.trim() && env.trim() && appCode.trim();

  /* render ----------------------------------------------------- */
  return (
    <>
      {preview && <PreviewModal />}
      {full && <FullscreenEditor />}

      <button className="btn-secondary btn-back" onClick={onBack}>
        ← Back
      </button>
      <ChartHeader />

      {/* version */}
      <label>Version</label>
      {versions.length ? (
        <select value={ver} onChange={e => setVer(e.target.value)}>
          {versions.map(v => (
            <option key={v.version} value={v.version}>
              {v.version}
              {v.date ? `  –  ${fmtDate(v.date)}` : ""}
            </option>
          ))}
        </select>
      ) : (
        <em>no versions found</em>
      )}

      {/* name / trio inputs */}
      {style === "name" ? (
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
      )}

      {/* download-only */}
      <label style={{ marginTop: "1rem", display: "flex", gap: ".5rem" }}>
        <input
          type="checkbox"
          checked={downloadOnly}
          onChange={e => setDL(e.target.checked)}
          style={{ transform: "translateY(2px)" }}
        />
        <span>I only want to download this Helm chart (do not install)</span>
      </label>

      {/* Friendly UX toggle – preserves scroll ------------------ */}
      {!downloadOnly && (
        <label style={{ marginTop: ".6rem", display: "flex", gap: ".5rem" }}>
          <input
            type="checkbox"
            checked={friendly}
            onChange={e => {
              const checked = e.target.checked;
              const y = window.scrollY; // keep scroll
              if (checked) {
                setTreeYaml(ymlRef.current);
              } else {
                ymlRef.current = treeYaml;
                if (edRef.current)
                  edRef.current.setValue(ymlRef.current);
              }
              setFr(checked);
              requestAnimationFrame(() => window.scrollTo(0, y));
            }}
            style={{ transform: "translateY(2px)" }}
          />
          <span>Switch to Friendly User Experience</span>
        </label>
      )}

      {/* editor area */}
      {!downloadOnly &&
        (busy ? (
          <div
            style={{
              height: "52vh",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Spinner size={36} />
          </div>
        ) : friendly ? (
          <YamlTreeEditor
            yamlText={treeYaml}
            onChange={txt => {
              setTreeYaml(txt);
              ymlRef.current = txt;
            }}
          />
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
        ))}

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
}
