import React, { useEffect, useState } from "react";

/* Expects backend to return [{ project, file, app }] */
export default function AppsList({ file }) {
  const [apps, setApps]   = useState([]);
  const [icons, setIcons] = useState({});

  /* load apps for active file */
  useEffect(() => {
    if (!file) return;
    fetch(`/api/apps?file=${encodeURIComponent(file)}`)
      .then((r) => r.json())
      .then(setApps);
  }, [file]);

  /* lazy-load logos */
  useEffect(() => {
    apps.forEach(({ app }) => {
      const key = `${app.repoURL}/${app.chart}`;
      if (icons[key]) return;
      fetch(`/api/search?q=${encodeURIComponent(app.chart)}`)
        .then((r) => r.json())
        .then((arr) => {
          const hit = arr.find((p) => p.name === app.chart);
          setIcons((m) => ({ ...m, [key]: hit?.logo }));
        });
    });
  }, [apps, icons]);

  /* delete wrapper */
  async function del(release, project) {
    if (!window.confirm(`Delete ${release} (${project})?`)) return;
    await fetch("/api/apps/delete", {
      method : "POST",
      headers: { "Content-Type": "application/json" },
      body   : JSON.stringify({ release, namespace: project }),
    });
    setApps((a) => a.filter(({ app }) => app.name !== release));
  }

  return (
    <>
      <h2>Applications</h2>
      {apps.length === 0 && <p>No applications in this file.</p>}

      <div className="apps-list">
        {apps.map(({ project, app }) => {
          const { name, repoURL, chart } = app;
          const key = `${repoURL}/${chart}`;

          return (
            <div className="app-card" key={project + "/" + name}>
              {icons[key] ? <img src={icons[key]} alt="" /> : <span>📦</span>}

              <div>
                <span className="name">{name}</span>
                <br />
                <small>{project}</small>
              </div>

              <span
                className="del-btn"
                onClick={() => del(name, project)}
                title="Delete"
              >
                🗑
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}
