import React, { useEffect, useState } from "react";
import AppDetails from "./AppDetails.jsx";
import Spinner    from "./Spinner.jsx";

/* ─── URL helpers (same pattern as in App.jsx) ─────────────────── */
function readSearch()   { return new URLSearchParams(window.location.search); }
function pushSearch(sp) { window.history.pushState(null,"",`?${sp}`); }

export default function AppsList({ file }) {
  const [flat,  setFlat]  = useState([]);
  const [sel,   setSel]   = useState(null);     // { project,file,app } | null
  const [busy,  setBusy]  = useState(true);

  /* ─── fetch once per YAML file ───────────────────────────────── */
  useEffect(() => {
    if (!file) return;
    setBusy(true);
    fetch(`/api/apps?file=${encodeURIComponent(file)}`)
      .then(r=>r.json())
      .then(list => { setFlat(list); setBusy(false); });
  }, [file]);

  /* ─── on first render → open detail if ?details=proj~app is set */
  useEffect(() => {
    if (busy) return;                              // wait for data
    const sp = readSearch();
    const tgt = sp.get("details");
    if (!tgt) return;

    const [proj,name] = tgt.split("~");
    const hit = flat.find(f => f.project===proj && f.app.name===name);
    if (hit) setSel(hit);
  }, [busy, flat]);

  /* ─── helper: derive chart + version from either style ───────── */
  function derive(app) {
    if (app.chart) return { chart: app.chart, version: app.targetRevision||"—" };
    const seg = (app.path||"").split("/").filter(Boolean);
    return { chart: seg.at(-2)||"—", version: seg.at(-1)||"—" };
  }

  /* ─── open / close detail helpers  (sync with URL) ──────────── */
  function openDetail(hit){
    const sp = readSearch();
    sp.set("details",`${hit.project}~${hit.app.name}`);
    pushSearch(sp);
    setSel(hit);
  }
  function closeDetail(){
    const sp = readSearch();
    sp.delete("details");
    pushSearch(sp);
    setSel(null);
  }

  /* ─── render ─────────────────────────────────────────────────── */
  if (busy){
    return (
      <div style={{ padding:"2rem", textAlign:"center" }}>
        <Spinner size={40}/>
      </div>
    );
  }

  const grouped = flat.reduce((m,it)=>{ (m[it.project]??=[]).push(it);return m;},{} );

  return (
    <>
      {Object.entries(grouped).map(([project,apps])=>(
        <section key={project} className="project-group">
          <h3>{project}</h3>

          <div className="apps-list">
            {apps.map(hit=>{
              const { chart,version } = derive(hit.app);
              const clickable = chart!=="—";
              return (
                <div key={project+"/"+hit.app.name}
                     className="app-card"
                     style={{cursor:clickable?"pointer":"default"}}
                     {...(clickable && { onClick:()=>openDetail(hit) })}>
                  <span>📦</span>
                  <div style={{ minWidth:0 }}>
                    <span className="name"
                          style={{whiteSpace:"nowrap",overflow:"hidden",
                                  textOverflow:"ellipsis"}}>
                      {hit.app.name}
                    </span><br/>
                    <small>{chart}:{version}</small>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {sel && <AppDetails {...sel} onClose={closeDetail} />}
    </>
  );
}
