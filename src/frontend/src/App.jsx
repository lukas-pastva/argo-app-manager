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
  const [values,     setValues] = useState("");
  const [adding,     setAdd]    = useState(false);

  useEffect(() => {
    fetch("/api/files")
      .then(r => r.json())
      .then(list => { setFiles(list); if(list.length) setActive(list[0]); });
  }, []);

  return (
    <div className="app-wrapper" style={{position:"relative"}}>
      <ThemeToggle/>
      {files.length>0 && (
        <Tabs files={files} active={activeFile} onSelect={setActive}/>
      )}

      {!adding ? (
        <>
          <h1>Argo Helm Toggler</h1>
          <AppsList file={activeFile}/>
          <button className="btn" onClick={()=>setAdd(true)}>＋ Insert Helm</button>
        </>
      ) : chart ? (
        <ValuesEditor
          chart={chart}
          values={values}
          setValues={setValues}
          onBack={() => { setChart(null); setAdd(false); }}
        />
      ) : (
        <>
          <button className="btn-secondary" onClick={()=>setAdd(false)}>← Back</button>
          <ChartSearch onSelect={setChart}/>
        </>
      )}
    </div>
  );
}
