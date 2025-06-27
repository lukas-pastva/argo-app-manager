import React,{useEffect,useState} from "react";

export default function AppsList({file}){
  const[apps,setApps]=useState([]); const[icons,setIcons]=useState({});
  useEffect(()=>{ if(file)
    fetch(`/api/apps?file=${encodeURIComponent(file)}`).then(r=>r.json()).then(setApps);
  },[file]);
  useEffect(()=>{ apps.forEach(a=>{
    const key=`${a.spec?.source?.repoURL}/${a.spec?.source?.chart}`; if(icons[key]) return;
    fetch(`/api/search?q=${encodeURIComponent(a.spec?.source?.chart)}`)
      .then(r=>r.json()).then(arr=>{
        const hit=arr.find(p=>p.name===a.spec?.source?.chart);
        setIcons(p=>({...p,[key]:hit?.logo}));
      });
  });},[apps]);

  async function del(name,ns){
    if(!window.confirm(`Delete ${name} (${ns})?`)) return;
    await fetch("/api/apps/delete",{
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body:JSON.stringify({ release:name, namespace:ns })
    });
    setApps(apps.filter(a=>a.metadata?.name!==name));
  }

  return(
    <>
      <h2>Applications</h2>
      {apps.length===0&&<p>No applications in this file.</p>}
      <div className="apps-list">
        {apps.map(a=>{
          const name=a.metadata?.name; const ns=a.spec?.destination?.namespace;
          const key=`${a.spec?.source?.repoURL}/${a.spec?.source?.chart}`;
          return(
            <div className="app-card" key={name}>
              {icons[key]?<img src={icons[key]} alt=""/>:<span>📦</span>}
              <div><span className="name">{name}</span><br/><small>{ns}</small></div>
              <span className="del-btn" onClick={()=>del(name,ns)} title="Delete">🗑</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
