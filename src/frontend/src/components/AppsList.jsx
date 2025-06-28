import React, { useEffect, useState } from "react";
import AppDetails  from "./AppDetails.jsx";
import Spinner     from "./Spinner.jsx";

const FETCH_ICONS = false;                // ← keep false to avoid ArtifactHub 429s

export default function AppsList({ file }) {
  const [flat,  setFlat]  = useState([]);
  const [icons, setIcons] = useState({});
  const [sel,   setSel]   = useState(null);
  const [busy,  setBusy]  = useState(true);

  /* load list ---------------------------------------------------- */
  useEffect(() => {
    if (!file) return;
    setBusy(true);
    fetch(`/api/apps?file=${encodeURIComponent(file)}`)
      .then(r => r.json())
      .then(list => { setFlat(list); setBusy(false); });
  }, [file]);

  /* optional logo look-ups -------------------------------------- */
  useEffect(() => {
    if (!FETCH_ICONS) return;
    flat.forEach(({ app }) => {
      const key = `${app.repoURL}/${app.chart}`;
      if (icons[key] !== undefined || (app.chart || "").length < 4) return;

      fetch(`/api/search?q=${encodeURIComponent(app.chart)}`)
        .then(r => r.json())
        .then(arr => {
          const hit = arr.find(p => p.name === app.chart);
          setIcons(m => ({ ...m, [key]: hit?.logo || false }));
        })
        .catch(() => setIcons(m => ({ ...m, [key]: false })));
    });
  }, [flat, icons]);

  /* group by appProject ----------------------------------------- */
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
            {apps.map(({ app, file }) => {
              const iKey = `${app.repoURL}/${app.chart}`;
              const logo = icons[iKey];
              const open = () => setSel({ project, file, app });

              return (
                <div className="app-card" key={project + "/" + app.name} onClick={open}>
                  {logo ? <img src={logo} alt="" /> : <span>📦</span>}
                  <div style={{ minWidth:0 }}>
                    <span className="name" style={{ whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                      {app.name}
                    </span><br/>
                    <small>{app.chart}:{app.targetRevision}</small>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {sel && <AppDetails {...sel} onClose={() => setSel(null)} />}
    </>
  );
}
