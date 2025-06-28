import React,{useEffect,useState} from "react";
import "./App.css";
import Tabs        from "./components/Tabs.jsx";
import ThemeToggle from "./components/ThemeToggle.jsx";
import AppsList    from "./components/AppsList.jsx";
import ChartSearch from "./components/ChartSearch.jsx";
import ValuesEditor from "./components/ValuesEditor.jsx";

export default function App(){
  const[files,setFiles]=useState([]);
  const[activeFile,setActive]=useState("");
  const[chart,setChart]=useState(null);
  const[values,setValues]=useState("");
  const[adding,setAdd]=useState(false);

  useEffect(()=>{
    fetch("/api/files").then(r=>r.json())
      .then(list=>{setFiles(list);if(list.length) setActive(list[0]);});
  },[]);

  return(
    <div className="app-wrapper">
      <ThemeToggle/>
      {files.length>0 && <Tabs files={files} active={activeFile} onSelect={setActive}/>}

      {/* top-right “Install” button (only on list page) */}
      {!adding && (
        <button className="btn" style={{float:"right",marginTop:"-.5rem"}}
                onClick={()=>setAdd(true)}>Install</button>
      )}

      {!adding ? (
        <>
          <h1>Argo Helm Toggler</h1>
          <AppsList file={activeFile}/>
        </>
      ) : chart ? (
        <ValuesEditor chart={chart} values={values} setValues={setValues}
                      onBack={()=>{setChart(null);setAdd(false);}}/>
      ) : (
        <>
          <button className="btn-secondary" onClick={()=>setAdd(false)}>← Back</button>
          <ChartSearch onSelect={setChart}/>
        </>
      )}
    </div>
  );
}
