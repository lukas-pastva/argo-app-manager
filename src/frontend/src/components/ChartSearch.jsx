import React, { useState } from "react";

/* Starts searching ArtifactHub only after ≥ 4 characters */
export default function ChartSearch({ onSelect }) {
  const [q, setQ]   = useState("");
  const [res, setRes] = useState([]);
  const [load, setLoad] = useState(false);

  async function search(t) {
    setQ(t);
    if (t.trim().length < 4) {
      setRes([]);
      return;
    }
    setLoad(true);
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(t.trim())}`);
      setRes(await r.json());
    } finally {
      setLoad(false);
    }
  }

  return (
    <>
      <div className="search-box">
        <input
          className="search-input"
          placeholder="Search chart (≥4 chars, e.g. grafana)…"
          value={q}
          onChange={(e) => search(e.target.value)}
        />
        {load && <span style={{ alignSelf: "center" }}>⏳</span>}
      </div>

      {res.length > 0 && (
        <div className="results-list">
          {res.map((c) => (
            <div
              key={c.repo + "/" + c.name}
              className="result-item"
              onClick={() => onSelect(c)}
            >
              {c.logo && <img src={c.logo} alt="" />}
              <div>
                <strong>{c.displayName || c.name}</strong>
                <br />
                <small>
                  {c.repo}/{c.name}:{c.version}
                </small>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
