import React, { useEffect, useState } from "react";
const modes=["auto","light","dark"];
export default function ThemeToggle(){
  const [mode,setMode]=useState(localStorage.getItem("theme-mode")||"auto");
  useEffect(()=>{
    const root=document.documentElement;
    root.dataset.theme = mode==="auto"
      ? (matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light")
      : mode;
    const mq=matchMedia("(prefers-color-scheme:dark)");
    const h=e=>{ if(mode==="auto") root.dataset.theme=e.matches?"dark":"light"; };
    mq.addEventListener("change",h); return()=>mq.removeEventListener("change",h);
  },[mode]);
  const icon=mode==="light"?"☀️":mode==="dark"?"🌙":"🖥️";
  return(
    <div className="theme-toggle" onClick={()=>{
      const nxt=modes[(modes.indexOf(mode)+1)%modes.length];
      setMode(nxt); localStorage.setItem("theme-mode",nxt);
    }} title={`Mode: ${mode}`}>{icon}</div>
  );
}
