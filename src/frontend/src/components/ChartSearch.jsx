import React, { useState } from "react";

export default function ChartSearch({ onSelect }) {
  const [q,   setQ]   = useState("");
  const [res, setRes] = useState([]);
  const [load,setLoad]= useState(false);

  async function search(t) {
    setQ(t);
    if (t.length < 4) { setRes([]); return; }      // ← 4-char gate

    setLoad(true);
    const r = await fetch(`/api/search?q=${encodeURIComponent(t)}`).then((r) =>
      r.json()
    );
    setRes(r);
    setLoad(false);
  }

  return (
    <>
      <div className="search-box">
        <input
          className="search-input"
          placeholder="Search chart (e.g. grafana)…"
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
