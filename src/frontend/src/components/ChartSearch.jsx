import React, { useState } from "react";

export default function ChartSearch({ onSelect }) {
  const [q,   setQ]   = useState("");
  const [res, setRes] = useState([]);
  const [load,setLoad]= useState(false);

  async function search(text) {
    setQ(text);
    if (text.length < 4) { setRes([]); return; }
    setLoad(true);
    const out = await fetch(`/api/search?q=${encodeURIComponent(text)}`).then(r=>r.json());
    // remove duplicates by name – keep the first hit
    const seen = new Set();
    setRes(out.filter(p=>!seen.has(p.name) && seen.add(p.name)));
    setLoad(false);
  }

  return (
    <>
      <div className="search-box">
        <input
          className="search-input"
          placeholder="Type at least 4 characters…"
          value={q}
          onChange={e=>search(e.target.value)}
        />
        {load && <span style={{ alignSelf:"center" }}>⏳</span>}
      </div>

      {res.length>0 && (
        <div className="results-list">
          {res.map(p=>(
            <div key={p.name} className="result-item" onClick={()=>onSelect(p)}>
              {p.logo && <img src={p.logo} alt="" />}
              <div style={{minWidth:0}}>
                <strong>{p.displayName||p.name}</strong><br/>
                <small>
                  {p.repo?.replace(/^https?:\/\//,"") || "—"} · {p.version}
                </small><br/>
                {p.description && (
                  <small style={{color:"var(--text-light)",display:"block",whiteSpace:"nowrap",
                                 overflow:"hidden",textOverflow:"ellipsis"}}>
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
