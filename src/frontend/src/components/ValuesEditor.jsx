import React,{useEffect,useRef,useState} from "react";
import * as monaco from "monaco-editor";

export default function ValuesEditor({chart,values,setValues,onBack}){
  const ref=useRef(); const[ns,setNs]=useState("default"); const[busy,setBusy]=useState(false);
  useEffect(()=>{(async()=>{
    const u=`https://artifacthub.io/api/v1/packages/helm/${encodeURIComponent(chart.repo)}/${chart.name}/values`;
    setValues(await fetch(u).then(r=>r.text()));
  })();},[]);
  useEffect(()=>{ if(!ref.current) return;
    const ed=monaco.editor.create(ref.current,{value:values||"# …",language:"yaml",automaticLayout:true,minimap:{enabled:false}});
    ed.onDidChangeModelContent(()=>setValues(ed.getValue()));
    return()=>ed.dispose(); },[values]);

  async function submit(){
    if(!window.confirm(`Deploy ${chart.name} into "${ns}"?`)) return;
    setBusy(true);
    await fetch("/api/apps",{method:"POST",headers:{ "Content-Type":"application/json" },
      body:JSON.stringify({ chart:chart.name, repo:chart.repo, version:chart.version,
                            release:chart.name, namespace:ns, userValuesYaml:values })});
    setBusy(false); alert("Deploy sent!"); onBack();
  }

  return(
    <>
      <button className="btn-secondary" onClick={onBack}>← Back</button>
      <h2>{chart.repo}/{chart.name}:{chart.version}</h2>
      <label>Namespace</label>
      <input value={ns} onChange={e=>setNs(e.target.value)}/>
      <div ref={ref} className="editor-frame"/>
      <button className="btn" onClick={submit} disabled={busy}>
        {busy?"Deploying…":"Deploy"}
      </button>
    </>
  );
}
