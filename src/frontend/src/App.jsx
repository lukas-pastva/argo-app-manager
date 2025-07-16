import React, { useEffect, useState } from "react";
import "./App.css";

import Tabs         from "./components/Tabs.jsx";
import ThemeToggle  from "./components/ThemeToggle.jsx";
import AppsList     from "./components/AppsList.jsx";
import ChartSearch  from "./components/ChartSearch.jsx";
import ValuesEditor from "./components/ValuesEditor.jsx";
import Notice       from "./components/Notice.jsx";

/* ─── tiny helpers for URL search-param handling ─────────────── */
function readSearch()  { return new URLSearchParams(window.location.search); }
function pushSearch(p) { window.history.pushState(null, "", `?${p}`); }

export default function App() {
  const [files,        setFiles]   = useState([]);
  const [activeFile,   setActive]  = useState("");
  const [chart,        setChart]   = useState(null);
  const [adding,       setAdd]     = useState(false);
  const [installStyle, setStyle]   = useState("name");   // auto-detected

  /* centralised notice state ----------------------------------- */
  const [notice, setNotice] = useState(null);            // {type,message,sub}

  const notify = (type, message, sub = "") => {
    setNotice({ type, message, sub });
  };

  /* ─── fetch style once on boot ─────────────────────────────── */
  useEffect(() => {
    fetch("/api/install-style")
      .then(r => r.json())
      .then(j => setStyle(j.style || "name"))
      .catch(() => {/* keep default */});
  }, []);

  /* ─── pull tab list once ───────────────────────────────────── */
  useEffect(() => {
    fetch("/api/files")
      .then(r => r.json())
      .then(list => {
        setFiles(list);
        if (list.length) setActive(list[0]);
      });
  }, []);

  /* ─── init from URL (?mode=install) ────────────────────────── */
  useEffect(() => {
    if (readSearch().get("mode") === "install") setAdd(true);
  }, []);

  const startInstall = () => {
    const sp = readSearch(); sp.set("mode", "install"); pushSearch(sp);
    setAdd(true);
  };
  const exitInstall  = () => {
    const sp = readSearch(); sp.delete("mode"); pushSearch(sp);
    setAdd(false); setChart(null);
  };

  return (
    <div className="app-wrapper" style={{ position: "relative" }}>
      <ThemeToggle />

      {files.length > 0 &&
        <Tabs files={files} active={activeFile} onSelect={setActive} />}

      <h1>Argo Helm Toggler</h1>

      <button className="btn" style={{ marginBottom: "1.2rem" }} onClick={startInstall}>
        ＋ Install chart
      </button>

      {!adding ? (
        /* normal view ------------------------------------------------------ */
        <AppsList file={activeFile} onNotify={notify} />
      ) : chart ? (
        /* install flow ----------------------------------------------------- */
        <ValuesEditor
          chart={chart}
          installStyle={installStyle}  /* ← auto */
          onBack={exitInstall}
          onNotify={notify}
        />
      ) : (
        /* choose chart ----------------------------------------------------- */
        <>
          <button className="btn-secondary btn-back" onClick={exitInstall}>← Back</button>
          <ChartSearch onSelect={setChart} />
        </>
      )}

      {/* global notice modal */}
      {notice && (
        <Notice
          type={notice.type}
          message={notice.message}
          sub={notice.sub}
          onClose={() => setNotice(null)}
        />
      )}
    </div>
  );
}
