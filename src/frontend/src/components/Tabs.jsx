import React from "react";

export default function Tabs({ files, active, onSelect }) {
  /* Hide the whole tabs bar when there is only one (or zero) file */
  if (!files || files.length <= 1) return null;

  return (
    <div className="tabs">
      {files.map(f => {
        /* derive display name: last two path segments without .yaml/.yml */
        const segments = f.split("/");
        const lastTwo = segments.slice(-2).join("/");
        const displayName = lastTwo.replace(/\.ya?ml$/i, "");
        return (
          <div
            key={f}
            className={`tab ${active === f ? "active" : ""}`}
            onClick={() => onSelect(f)}
            title={f}
          >
            {displayName}
          </div>
        );
      })}
    </div>
  );
}
