import React, { useState } from "react";

export default function ChartSearch({ onSelect }) {
  const [q,   setQ]   = useState("");
  const [res, setRes] = useState([]);
  const [load,setLoad]= useState(false);

  async function search(t) {
    setQ(t);
    if (t.length < 4) { setRes([]); return; }   // 4-char guard

    setLoad(true);
    const r = await fetch(`/api/search?q=${encodeURIComponent(t)}`).then(r=>r.json());
    /* dedupe by chart name, keep first hit */
    const uniq = [];
    const seen = new Set();
    r.forEach(p => { if (!seen.has(p.name)) { seen.add(p.name); uniq.push(p);} });
    setRes(uniq);
    setLoad(false);
  }

  return (
    <>
      <div className="search-box">
        <input
          className="search-input"
          placeholder="Type chart name (≥4 chars)…"
          value={q}
          onChange={e => search(e.target.value)}
        />
        {load && <span style={{ alignSelf:"center" }}>⏳</span>}
      </div>

      {res.length > 0 && (
        <div className="results-list">
          {res.map(c => (
            <div
              key={c.name}
              className="result-item"
              onClick={() => onSelect(c)}     /* only name + repo for now */
            >
              <strong>{c.displayName || c.name}</strong>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
