import React, { useEffect, useState } from "react";
import AppDetails from "./AppDetails.jsx";
import Spinner    from "./Spinner.jsx";

/* ─── URL helpers ─────────────────────────────────────────────── */
function readSearch()   { return new URLSearchParams(window.location.search); }
function pushSearch(sp) { window.history.pushState(null, "", `?${sp}`); }

/* ─── canonical app-ID (fallbacks) ────────────────────────────── */
function appId(app = {}) {
  return (
    app.name ??
    app.applicationCode ??
    [app.team, app.env, app.applicationCode].filter(Boolean).join("-")
  );
}

/* ─────────────────────────────────────────────────────────────── */

export default function AppsList({ file, onNotify = () => {} }) {
  const [flat,  setFlat]  = useState([]);
  const [sel,   setSel]   = useState(null);   // { project,file,app } | null
  const [busy,  setBusy]  = useState(true);

  /* fetch once per YAML file ----------------------------------- */
  useEffect(() => {
    if (!file) return;
    setBusy(true);
    fetch(`/api/apps?file=${encodeURIComponent(file)}`)
      .then(r => r.json())
      .then(list => { setFlat(list); setBusy(false); });
  }, [file]);

  /* reopen detail if ?details=proj~id present ------------------ */
  useEffect(() => {
    if (busy) return;
    const sp  = readSearch();
    const tgt = sp.get("details");
    if (!tgt) return;

    const [proj, id] = tgt.split("~");
    const hit = flat.find(f => f.project === proj && appId(f.app) === id);
    if (hit) setSel(hit);
  }, [busy, flat]);

  /* derive chart + version from either style ------------------- */
  function derive(app) {
    if (app.chart) return { chart: app.chart, version: app.targetRevision || "—" };
    const seg = (app.path || "").split("/").filter(Boolean);
    return { chart: seg.at(-2) || "—", version: seg.at(-1) || "—" };
  }

  /* helpers: open / close detail ------------------------------- */
  function openDetail(hit) {
    const sp = readSearch();
    sp.set("details", `${hit.project}~${appId(hit.app)}`);
    pushSearch(sp);
    setSel(hit);
  }
  function closeDetail() {
    const sp = readSearch();
    sp.delete("details");
    pushSearch(sp);
    setSel(null);
  }

  /* render ------------------------------------------------------ */
  if (busy) {
    return (
      <div style={{ padding: "2rem", textAlign: "center" }}>
        <Spinner size={40} />
      </div>
    );
  }

  const grouped = flat.reduce((m, it) => {
    (m[it.project] ??= []).push(it);
    return m;
  }, {});

  return (
    <>
      {Object.entries(grouped).map(([project, apps]) => (
        <section key={project} className="project-group">
          <h3>{project}</h3>

          <div className="apps-list">
            {apps.map(hit => {
              const id              = appId(hit.app);
              const { chart, version } = derive(hit.app);
              const clickable       = Boolean(id);

              return (
                <div
                  key={`${project}/${id}`}
                  className="app-card"
                  style={{ cursor: clickable ? "pointer" : "default" }}
                  {...(clickable && { onClick: () => openDetail(hit) })}
                >
                  <span>📦</span>
                  <div style={{ minWidth: 0 }}>
                    <span
                      className="name"
                      style={{
                        whiteSpace   : "nowrap",
                        overflow     : "hidden",
                        textOverflow : "ellipsis",
                      }}
                    >
                      {id || "(unnamed)"}
                    </span>
                    <br />
                    <small>{chart}:{version}</small>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {sel && <AppDetails {...sel} onClose={closeDetail} onNotify={onNotify} />}
    </>
  );
}
