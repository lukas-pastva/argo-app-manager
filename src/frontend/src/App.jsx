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

  /* UI config from backend env variables ------------------------ */
  const [uiCfg, setUiCfg] = useState({
    appTitle: "",
    appDescription: "",
    downloadOnly: false,
  });

  /* centralised notice state ----------------------------------- */
  const [notice, setNotice] = useState(null);            // {type,message,sub}

  const notify = (type, message, sub = "") => {
    setNotice({ type, message, sub });
  };

  /* ─── fetch UI config once on boot ───────────────────────────── */
  useEffect(() => {
    fetch("/api/ui-config")
      .then(r => r.json())
      .then(j => setUiCfg({
        appTitle      : j.appTitle       || "",
        appDescription: j.appDescription || "",
        downloadOnly  : Boolean(j.downloadOnly),
      }))
      .catch(() => {/* keep defaults */});
  }, []);

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

  /* ─── derive display title ─────────────────────────────────── */
  const title = uiCfg.appTitle || "Argo App Manager";
  /* split first word for accent colouring */
  const spaceIdx   = title.indexOf(" ");
  const titleFirst = spaceIdx > 0 ? title.slice(0, spaceIdx) : title;
  const titleRest  = spaceIdx > 0 ? title.slice(spaceIdx) : "";

  return (
    <div className="app-wrapper" style={{ position: "relative" }}>
      {/* ── sticky top bar ────────────────────────────────────── */}
      <header className="top-bar">
        <div>
          <h1><span>{titleFirst}</span>{titleRest}</h1>
          {uiCfg.appDescription && (
            <p style={{
              margin: ".15rem 0 0",
              fontSize: ".82rem",
              color: "var(--text-light)",
              lineHeight: 1.4,
            }}>
              {uiCfg.appDescription}
            </p>
          )}
        </div>
        <ThemeToggle />
      </header>

      {files.length > 0 &&
        <Tabs files={files} active={activeFile} onSelect={setActive} />}

      <button className="btn" style={{ marginBottom: "1.2rem" }} onClick={startInstall}>
        + Install chart
      </button>

      {!adding ? (
        /* normal view ------------------------------------------------------ */
        <AppsList file={activeFile} onNotify={notify} />
      ) : chart ? (
        /* install flow ----------------------------------------------------- */
        <ValuesEditor
          chart={chart}
          installStyle={installStyle}  /* ← auto */
          forceDownloadOnly={uiCfg.downloadOnly}
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
