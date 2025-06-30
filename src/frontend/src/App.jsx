import React, { useEffect, useState } from "react";
import "./App.css";

import Tabs         from "./components/Tabs.jsx";
import ThemeToggle  from "./components/ThemeToggle.jsx";
import AppsList     from "./components/AppsList.jsx";
import ChartSearch  from "./components/ChartSearch.jsx";
import ValuesEditor from "./components/ValuesEditor.jsx";

/* ─── tiny helpers for URL search-param handling ───────────────── */
function readSearch()     { return new URLSearchParams(window.location.search); }
function pushSearch(sp)   { window.history.pushState(null, "", `?${sp}`); }

export default function App() {
  const [files,      setFiles]  = useState([]);
  const [activeFile, setActive] = useState("");
  const [chart,      setChart]  = useState(null);
  const [adding,     setAdd]    = useState(false);       // “install” flow?

  /* ─── pull tab list once ─────────────────────────────────────── */
  useEffect(() => {
    fetch("/api/files")
      .then(r => r.json())
      .then(list => {
        console.log("[DEBUG] fetched /api/files →", list);
        setFiles(list);
        if (list.length) {
          console.log("[DEBUG] defaulting activeFile to", list[0]);
          setActive(list[0]);
        }
      });
  }, []);

  /* ─── initialise state from URL ( ?mode=install … ) ──────────── */
  useEffect(() => {
    const sp = readSearch();
    if (sp.get("mode")==="install") setAdd(true);
  }, []);

  /* ─── handle “＋ Install chart” click ─────────────────────────── */
  function startInstall() {
    const sp = readSearch(); sp.set("mode","install"); pushSearch(sp);
    setAdd(true);
  }
  /* ─── back from install UI ───────────────────────────────────── */
  function exitInstall() {
    const sp = readSearch(); sp.delete("mode"); pushSearch(sp);
    setAdd(false); setChart(null);
  }

  return (
    <div className="app-wrapper" style={{ position:"relative" }}>
      <ThemeToggle />

      {files.length>0 &&
        <Tabs files={files} active={activeFile} onSelect={setActive}/>}

      <h1>Argo Helm Toggler</h1>

      <button
        className="btn"
        style={{ marginBottom:"1.2rem" }}
        onClick={startInstall}
      >
        ＋ Install chart
      </button>

      {/* ─── MAIN VIEW / INSERT FLOW ────────────────────────────── */}
      {!adding ? (
        <AppsList file={activeFile} />                        // normal mode
      ) : chart ? (                                           // values-editor
        <ValuesEditor chart={chart} onBack={exitInstall} />
      ) : (
        <>                                                   {/* chart search */}
          <button className="btn-secondary btn-back" onClick={exitInstall}>
            ← Back
          </button>
          <ChartSearch onSelect={setChart}/>
        </>
      )}
    </div>
  );
}
