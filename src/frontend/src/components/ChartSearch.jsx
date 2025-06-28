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
  const [q,   setQ]   = useState("");
  const [res, setRes] = useState([]);
  const [load,setLoad]= useState(false);

  async function search(text) {
    setQ(text);
    if (text.length < 3) {        // AH doesn’t search for <3 chars
      setRes([]);
      return;
    }
    setLoad(true);

    const url =
      `${AH_BASE}/packages/search?kind=0&limit=20&ts_query_web=` +
      encodeURIComponent(text);

    const { packages: hits = [] } = await fetch(url).then(r => r.json());
    setRes(hits.map(normalize));
    setLoad(false);
  }

  return (
    <>
      <div className="search-box">
        <input
          className="search-input"
          placeholder="Start typing a chart name…"
          value={q}
          onChange={e => search(e.target.value)}
        />
        {load && <span style={{ alignSelf: "center" }}>⏳</span>}
      </div>

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
  );
}
