import React, { useState } from "react";

const AH_BASE = "https://artifacthub.io/api/v1";

/**
 * Tiny helper that turns the raw API answer into the subset of
 * data we want to show in the type-ahead list.
 */
function normalize(hit) {
  return {
    /* package basics ------------------------------------------------------ */
    packageId   : hit.package_id,
    name        : hit.name,
    displayName : hit.display_name || hit.name,
    description : hit.description,
    logo        : hit.logo_image_id
      ? `https://artifacthub.io/image/${hit.logo_image_id}`
      : null,

    /* repository info ----------------------------------------------------- */
    repoName    : hit.repository.name,
    repoURL     : hit.repository.url,

    /* convenience --------------------------------------------------------- */
    latest      : hit.version,
  };
}

export default function ChartSearch({ onSelect }) {
  const [mode, setMode] = useState("artifacthub"); // "artifacthub" | "github"

  /* ArtifactHub state */
  const [q,   setQ]   = useState("");
  const [res, setRes] = useState([]);
  const [load,setLoad]= useState(false);

  /* GitHub state */
  const [ghUrl, setGhUrl]     = useState("");
  const [ghLoad, setGhLoad]   = useState(false);
  const [ghError, setGhError] = useState("");

  async function search(text) {
    setQ(text);
    if (text.length < 3) {
      setRes([]);
      return;
    }
    setLoad(true);

    const url =
      `${AH_BASE}/packages/search?kind=0&limit=20&ts_query_web=` +
      encodeURIComponent(text);

    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(r.statusText);
      const { packages: hits = [] } = await r.json();
      setRes(hits.map(normalize));
    } catch (e) {
      console.error("[ChartSearch] fetch error:", e.message);
      setRes([]);
    } finally {
      setLoad(false);
    }
  }

  async function loadFromGitHub() {
    if (!ghUrl.trim()) return;
    setGhLoad(true);
    setGhError("");
    try {
      const r = await fetch(`/api/github/chart-info?url=${encodeURIComponent(ghUrl.trim())}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      onSelect({
        packageId   : null,
        name        : data.name,
        displayName : data.displayName,
        description : data.description,
        logo        : null,
        repoName    : null,
        repoURL     : null,
        latest      : data.version,
        /* GitHub-specific fields */
        source      : "github",
        githubUrl   : data.githubUrl,
        githubBranch: data.githubBranch,
        chartPath   : data.chartPath,
        chartVersion: data.version,
        _rawGhUrl   : ghUrl.trim(),
      });
    } catch (e) {
      console.error("[ChartSearch] GitHub error:", e.message);
      setGhError(e.message);
    } finally {
      setGhLoad(false);
    }
  }

  return (
    <>
      {/* source toggle */}
      <div style={{ display: "flex", gap: ".25rem", marginBottom: ".8rem" }}>
        <button
          className={mode === "artifacthub" ? "btn" : "btn-secondary"}
          style={{ padding: ".4rem 1rem", fontSize: ".82rem" }}
          onClick={() => setMode("artifacthub")}
        >
          ArtifactHub
        </button>
        <button
          className={mode === "github" ? "btn" : "btn-secondary"}
          style={{ padding: ".4rem 1rem", fontSize: ".82rem" }}
          onClick={() => setMode("github")}
        >
          GitHub URL
        </button>
      </div>

      {mode === "artifacthub" ? (
        <>
          <div className="search-box">
            <input
              className="search-input"
              placeholder="Search ArtifactHub for a chart..."
              value={q}
              onChange={e => search(e.target.value)}
            />
            {load && <span style={{ alignSelf: "center" }}>⏳</span>}
          </div>
          {!res.length && !load && (
            <p className="search-hint">Type at least 3 characters to search ArtifactHub</p>
          )}

          {res.length > 0 && (
            <div className="results-list">
              {res.map(p => (
                <div key={p.packageId} className="result-item"
                     onClick={() => onSelect(p)}>
                  {p.logo && <img src={p.logo} alt="" />}
                  <div style={{ minWidth: 0 }}>
                    <strong>{p.displayName}</strong>
                    <br />
                    <small>
                      {p.repoName} · {p.latest}
                    </small>
                    {p.description && (
                      <small className="truncate text-light">
                        {p.description}
                      </small>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="search-box">
            <input
              className="search-input"
              placeholder="https://github.com/owner/repo/tree/branch/path/to/chart"
              value={ghUrl}
              onChange={e => { setGhUrl(e.target.value); setGhError(""); }}
              onKeyDown={e => { if (e.key === "Enter") loadFromGitHub(); }}
            />
            <button
              className="btn"
              onClick={loadFromGitHub}
              disabled={ghLoad || !ghUrl.trim()}
              style={{ flexShrink: 0 }}
            >
              {ghLoad ? "Loading..." : "Load chart"}
            </button>
          </div>
          <p className="search-hint">
            Paste a GitHub URL pointing to a Helm chart directory (must contain Chart.yaml)
          </p>
          {ghError && (
            <p style={{ color: "var(--danger)", fontSize: ".85rem", marginTop: ".4rem" }}>
              {ghError}
            </p>
          )}
        </>
      )}
    </>
  );
}
