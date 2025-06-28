import React, { useEffect, useState } from "react";
import AppDetails from "./AppDetails.jsx";
import Spinner    from "./Spinner.jsx";

export default function AppsList({ file }) {
  const [flat,  setFlat]  = useState([]);
  const [sel,   setSel]   = useState(null);
  const [busy,  setBusy]  = useState(true);

  /* ── fetch once per YAML file ───────────────────────────────── */
  useEffect(() => {
    if (!file) return;
    setBusy(true);
    fetch(`/api/apps?file=${encodeURIComponent(file)}`)
      .then(r => r.json())
      .then(list => { setFlat(list); setBusy(false); });
  }, [file]);

  /* ── helper: derive chart + version from either style ───────── */
  function derive(app) {
    if (app.chart) {
      return { chart: app.chart, version: app.targetRevision || "—" };
    }
    /* path style: external/<owner>/<CHART>/<VERSION> */
    const seg = (app.path || "").split("/").filter(Boolean);
    const version = seg.at(-1)  || "—";
    const chart   = seg.at(-2)  || "—";
    return { chart, version };
  }

  /* ── group by appProject for nicer layout ───────────────────── */
  const grouped = flat.reduce((m, it) => {
    (m[it.project] ??= []).push(it);
    return m;
  }, {});

  /* ── render ─────────────────────────────────────────────────── */
  if (busy) {
    return (
      <div style={{ padding:"2rem", textAlign:"center" }}>
        <Spinner size={40}/>
      </div>
    );
  }

  return (
    <>
      {Object.entries(grouped).map(([project, apps]) => (
        <section key={project} className="project-group">
          <h3>{project}</h3>

          <div className="apps-list">
            {apps.map(({ app, file }) => {
              const { chart, version } = derive(app);
              /* if we can’t identify a chart → no click-through */
              const clickable = chart !== "—";

              const card = (
                <div
                  className="app-card"
                  key={project + "/" + app.name}
                  {...(clickable && { onClick: () => setSel({ project, file, app }) })}
                  style={{ cursor: clickable ? "pointer" : "default" }}
                >
                  <span>📦</span>
                  <div style={{ minWidth:0 }}>
                    <span
                      className="name"
                      style={{ whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}
                    >
                      {app.name}
                    </span>
                    <br/>
                    <small>{chart}:{version}</small>
                  </div>
                </div>
              );

              return card;
            })}
          </div>
        </section>
      ))}

      {sel && <AppDetails {...sel} onClose={() => setSel(null)} />}
    </>
  );
}
