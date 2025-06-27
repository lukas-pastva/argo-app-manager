import React, { useEffect, useState } from "react";

const FETCH_ICONS = false;            // ← set to true to re-enable look-ups

export default function AppsList({ file }) {
  const [apps,  setApps]  = useState([]);
  const [icons, setIcons] = useState({});   // key → imgURL | false (= tried)

  /* ─── YAML → apps list ───────────────────────────────────────── */
  useEffect(() => {
    if (!file) return;
    fetch(`/api/apps?file=${encodeURIComponent(file)}`)
      .then((r) => r.json())
      .then(setApps);
  }, [file]);

  /* ─── (optional) logo fetch with “try only once” guard ───────── */
  useEffect(() => {
    if (!FETCH_ICONS) return;

    apps.forEach(({ app }) => {
      const { repoURL, chart } = app;
      if (!chart || chart.length < 4) return;       // skip short names

      const key = `${repoURL}/${chart}`;
      if (icons[key] !== undefined) return;        // already done (true/false)

      fetch(`/api/search?q=${encodeURIComponent(chart)}`)
        .then((r) => r.json())
        .then((arr) => {
          const hit = arr.find((p) => p.name === chart);
          setIcons((m) => ({ ...m, [key]: hit?.logo || false }));
        })
        .catch(() => setIcons((m) => ({ ...m, [key]: false }))); // remember fail
    });
  }, [apps, icons]);

  /* ─── delete helper ──────────────────────────────────────────── */
  async function del(name, project) {
    if (!window.confirm(`Delete ${name} (${project})?`)) return;
    await fetch("/api/apps/delete", {
      method : "POST",
      headers: { "Content-Type": "application/json" },
      body   : JSON.stringify({ release: name, namespace: project }),
    });
    setApps((a) => a.filter(({ app }) => app.name !== name));
  }

  /* ─── render ─────────────────────────────────────────────────── */
  return (
    <>
      <h2>Applications</h2>
      {apps.length === 0 && <p>No applications in this file.</p>}

      <div className="apps-list">
        {apps.map(({ project, app }) => {
          const { name, repoURL, chart } = app;
          const key  = `${repoURL}/${chart}`;
          const logo = icons[key];

          return (
            <div className="app-card" key={project + "/" + name}>
              {logo ? <img src={logo} alt="" /> : <span>📦</span>}

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
