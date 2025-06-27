import React from "react";
export default function Tabs({ files, active, onSelect }) {
  return (
    <div className="tabs">
      {files.map(f=>(
        <div key={f}
             className={`tab ${active===f?"active":""}`}
             onClick={()=>onSelect(f)}
             title={f}>
          {f.replace(/^.*\//,"")}
        </div>
      ))}
    </div>
  );
}
