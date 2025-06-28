import React, { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";

export default function AppDetails({ project, file, app, onClose }) {
  const [data,setData] = useState(null);
  const defRef = useRef(null), ovrRef = useRef(null);

  /* fetch once ---------------------------------------------------- */
  useEffect(()=>{
    const { name, chart, targetRevision:version, repoURL } = app;
    const qs = new URLSearchParams({ project,name,chart,version,repoURL,file });
    fetch(`/api/app/values?${qs}`).then(r=>r.json()).then(setData);
  },[project,file,app]);

  /* mount monaco when data ready --------------------------------- */
  useEffect(()=>{
    if(!data||!defRef.current) return;
    const def = monaco.editor.create(defRef.current,{
      value:data.defaultValues||"# (no file)",
      language:"yaml",readOnly:true,automaticLayout:true,minimap:{enabled:false}
    });
    const ovr = monaco.editor.create(ovrRef.current,{
      value:data.overrideValues||"# (no override)",
      language:"yaml",readOnly:true,automaticLayout:true,minimap:{enabled:false}
    });
    return()=>{def.dispose();ovr.dispose();};
  },[data]);

  if(!data) return null;

  return(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={e=>e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>

        <h2 style={{marginTop:0}}>{app.name} – <em>{project}</em></h2>

        {/* ─── chart meta ─── */}
        <p style={{marginBottom:"1rem"}}>
          <strong>{app.chart}</strong> @ {app.targetRevision}<br/>
          <small>{app.repoURL}</small><br/>
          {data.meta.description && <>{data.meta.description}<br/></>}
          {data.meta.maintainers?.length>0 &&
            <small>Maintainers: {data.meta.maintainers.join(", ")}</small>}
        </p>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1rem"}}>
          <div>
            <h3>Chart defaults</h3>
            <div ref={defRef} style={{height:"45vh",border:"1px solid #ccc"}}/>
          </div>
          <div>
            <h3>Override values</h3>
            <div ref={ovrRef} style={{height:"45vh",border:"1px solid #ccc"}}/>
          </div>
        </div>
      </div>
    </div>
  );
}
