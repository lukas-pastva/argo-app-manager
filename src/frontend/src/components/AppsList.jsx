import React, { useEffect, useState } from "react";
import AppDetails from "./AppDetails.jsx";
import Spinner    from "./Spinner.jsx";

export default function AppsList({ file }) {
  const [flat,  setFlat]  = useState([]);
  const [sel,   setSel]   = useState(null);
  const [busy,  setBusy]  = useState(true);

  /* fetch once per file ------------------------------------------ */
  useEffect(() => {
    if (!file) return;
    setBusy(true);
    fetch(`/api/apps?file=${encodeURIComponent(file)}`)
      .then(r => r.json())
      .then(list => { setFlat(list); setBusy(false); });
  }, [file]);

  /* group by appProject ------------------------------------------ */
  const grouped = flat.reduce((m, it) => {
    (m[it.project] ??= []).push(it);
    return m;
  }, {});

  /* render ------------------------------------------------------- */
  if (busy) return <div style={{ padding:"2rem" }}><Spinner size={32} /></div>;

  return (
    <>
      {Object.entries(grouped).map(([project, apps]) => (
        <section key={project} className="project-group">
          <h3>{project}</h3>

          <div className="apps-list">
            {apps.map(({ app, file, meta }) => (
              <div
                key={project + "/" + app.name}
                className="app-card"
                onClick={() => setSel({ project, file, app })}
              >
                <span>📦</span>
                <div style={{ minWidth:0 }}>
                  <span
                    className="name"
                    style={{ whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}
                  >
                    {app.name}
                  </span><br/>
                  <small>{app.chart}:{meta.version || app.targetRevision}</small>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {sel && <AppDetails {...sel} onClose={() => setSel(null)} />}
    </>
  );
}
