import React, { useEffect, useState } from "react";
import "./App.css";

import Tabs          from "./components/Tabs.jsx";
import ThemeToggle   from "./components/ThemeToggle.jsx";
import AppsList      from "./components/AppsList.jsx";
import ChartSearch   from "./components/ChartSearch.jsx";
import ValuesEditor  from "./components/ValuesEditor.jsx";

export default function App() {
  const [files,      setFiles]  = useState([]);
  const [activeFile, setActive] = useState("");
  const [chart,      setChart]  = useState(null);
  const [adding,     setAdd]    = useState(false);

  /* pull tab list once ------------------------------------------ */
  useEffect(() => {
    fetch("/api/files")
      .then(r => r.json())
      .then(list => { setFiles(list); if (list.length) setActive(list[0]); });
  }, []);

  return (
    <div className="app-wrapper" style={{ position:"relative" }}>
      <ThemeToggle />

      {files.length > 0 && (
        <Tabs files={files} active={activeFile} onSelect={setActive}/>
      )}

      <h1>Argo Helm Toggler</h1>

      <button
        className="btn"
        style={{ marginBottom:"1.2rem" }}
        onClick={() => setAdd(true)}
      >
        ＋ Install chart
      </button>

      {/* ─── MAIN VIEW / INSERT FLOW ────────────────────────────── */}
      {!adding ? (
        <AppsList file={activeFile} />
      ) : chart ? (
        <ValuesEditor
          chart={chart}
          onBack={() => { setChart(null); setAdd(false); }}
        />
      ) : (
        <>
          <button
            className="btn-secondary btn-back"
            onClick={() => setAdd(false)}
          >
            ← Back
          </button>
          <ChartSearch onSelect={setChart} />
        </>
      )}
    </div>
  );
}
