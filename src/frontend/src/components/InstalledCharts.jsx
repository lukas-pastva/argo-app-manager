import React, { useEffect, useState } from "react";
import Spinner from "./Spinner.jsx";

export default function InstalledCharts() {
  const [charts, setCharts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    fetch("/api/installed-charts")
      .then(r => r.json())
      .then(data => { setCharts(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ padding: "2rem", textAlign: "center" }}>
        <Spinner size={36} />
      </div>
    );
  }

  if (!charts.length) return null;

  /* group by publisher */
  const grouped = {};
  for (const c of charts) {
    (grouped[c.publisher] ??= []).push(c);
  }

  /* filter */
  const q = filter.toLowerCase();
  const filtered = q
    ? Object.fromEntries(
        Object.entries(grouped)
          .map(([pub, list]) => [
            pub,
            list.filter(
              c =>
                c.chart.toLowerCase().includes(q) ||
                pub.toLowerCase().includes(q),
            ),
          ])
          .filter(([, list]) => list.length),
      )
    : grouped;

  const totalCharts = Object.values(filtered).reduce(
    (s, list) => s + list.length,
    0,
  );

  return (
    <div className="installed-charts">
      <div className="installed-header">
        <h2 style={{ margin: 0 }}>
          Installed Charts
          <span className="installed-badge">{totalCharts}</span>
        </h2>
        <input
          className="installed-filter"
          type="text"
          placeholder="Filter charts..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
      </div>

      {Object.entries(filtered)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([publisher, list]) => (
          <div key={publisher} className="installed-group">
            <div className="installed-publisher">{publisher}</div>
            <div className="installed-grid">
              {list.map(c => (
                <div key={`${publisher}/${c.chart}`} className="installed-card">
                  <div className="installed-card-name">{c.chart}</div>
                  <div className="installed-card-versions">
                    {c.versions.map(v => (
                      <span key={v} className="installed-version-tag">
                        {v}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}
