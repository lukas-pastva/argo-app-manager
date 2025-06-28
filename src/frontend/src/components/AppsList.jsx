import React, { useEffect, useState } from "react";
import AppDetails from "./AppDetails.jsx";

const FETCH_ICONS = false;              // ← keep false to avoid 429s

export default function AppsList({ file }) {
  const [flat,  setFlat]  = useState([]);      // flat backend list
  const [icons, setIcons] = useState({});      // key → logoURL | false
  const [sel,   setSel]   = useState(null);    // currently opened details

  /* --- load apps for active file -------------------------------- */
  useEffect(() => {
    if (!file) return;
    fetch(`/api/apps?file=${encodeURIComponent(file)}`)
      .then((r) => r.json())
      .then(setFlat);
  }, [file]);

  /* --- optional logo look-ups ----------------------------------- */
  useEffect(() => {
    if (!FETCH_ICONS) return;
    flat.forEach(({ app }) => {
      const { repoURL = "", chart = "" } = app;
      if (chart.length < 4) return;
      const key = `${repoURL}/${chart}`;
      if (icons[key] !== undefined) return;

      fetch(`/api/search?q=${encodeURIComponent(chart)}`)
        .then((r) => r.json())
        .then((arr) => {
          const hit = arr.find((p) => p.name === chart);
          setIcons((m) => ({ ...m, [key]: hit?.logo || false }));
        })
        .catch(() => setIcons((m) => ({ ...m, [key]: false })));
    });
  }, [flat, icons]);

  /* --- group by project ----------------------------------------- */
  const grouped = flat.reduce((m, it) => {
    (m[it.project] ??= []).push(it);
    return m;
  }, {});

  /* --- render ---------------------------------------------------- */
  return (
    <>
      <h2>Applications</h2>

      {Object.entries(grouped).map(([project, apps]) => (
        <div key={project} style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ margin: "0.6rem 0" }}>{project}</h3>

          <div className="apps-list">
            {apps.map(({ app, file }) => {
              const key   = `${app.repoURL}/${app.chart}`;
              const logo  = icons[key];
              const click = () => setSel({ project, file, app });

              return (
                <div className="app-card" key={project + "/" + app.name} onClick={click}>
                  {logo ? <img src={logo} alt="" /> : <span>📦</span>}
                  <div>
                    <span className="name">{app.name}</span>
                    <br />
                    <small>{app.chart}:{app.targetRevision}</small>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {sel && <AppDetails {...sel} onClose={() => setSel(null)} />}
    </>
  );
}
