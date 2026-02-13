/*  YamlTreeEditor.jsx – v6
    • Scroll position preserved when editing
    • Help ℹ icon larger & placed to the far-left
    • Tooltip only on icon hover
    • Expanding a node shows first few children; "More" reveals the rest
*/
import React, { useState, useCallback, useMemo, useRef } from "react";
import yaml from "js-yaml";

/* helper – deep clone */
const clone = obj => JSON.parse(JSON.stringify(obj));

/* pull “# …” comments that sit right above a key */
function extractHelp(src=""){
  const lines=src.split(/\r?\n/);const stack=[];const map=new Map();let buf=[];
  const flush=p=>{if(!buf.length)return;const t=buf.join(" ").replace(/^--\s*/,"").trim();
    if(t)map.set(p,t);buf=[];};
  lines.forEach(l=>{
    const cm=l.match(/^\s*#\s?(.*)/);if(cm){buf.push(cm[1].trim());return;}
    const km=l.match(/^(\s*)([\w.-]+):/);if(!km){buf=[];return;}
    const d=km[1].length/2;stack.length=d;stack[d]=km[2];flush(stack.slice(0,d+1).join("."));});
  return map;
}

export default function YamlTreeEditor({ yamlText="", onChange }){
  /* initial parse */
  const [tree,setTree]=useState(()=>{try{return yaml.load(yamlText)||{};}catch{return{};}});
  const helps=useMemo(()=>extractHelp(yamlText),[yamlText]);

  /* expansion state */
  const [expanded,setExp]=useState(new Set());
  const [showAll,setShowAll]=useState(new Set()); /* paths where "More" was clicked */
  const INITIAL_SHOW=5;
  const rootRef=useRef(null);

  const preserveScroll=cb=>{
    const y=rootRef.current?.scrollTop||0;
    cb();
    requestAnimationFrame(()=>{if(rootRef.current)rootRef.current.scrollTop=y;});
  };

  const toggle=path=>preserveScroll(()=>{
    setExp(s=>{const n=new Set(s);n.has(path)?n.delete(path):n.add(path);return n;});
    setShowAll(s=>{const n=new Set(s);n.delete(path);return n;});
  });

  const revealMore=path=>preserveScroll(()=>
    setShowAll(s=>{const n=new Set(s);n.add(path);return n;}));

  const write=(arr,val)=>preserveScroll(()=>{
    const nxt=clone(tree);let ptr=nxt;arr.slice(0,-1).forEach(k=>ptr=ptr[k]);
    ptr[arr.at(-1)]=val;setTree(nxt);onChange?.(yaml.dump(nxt,{noRefs:true}));});

  /* Node renderer ------------------------------------------------ */
  const Node=({k,v,depth,path})=>{
    const indent={paddingLeft:depth*16};
    const isObj=v&&typeof v==="object"&&!Array.isArray(v);
    const isArr=Array.isArray(v);

    /* object / array ------------------------------------------- */
    if(isObj||isArr){
      const open=expanded.has(path);
      return(
        <div className={`yaml-tree-block ${depth===0?"root":""}`} style={indent}>
          <div className="yaml-tree-row clickable" onClick={()=>toggle(path)}>
            {helps.has(path)&&(
              <>
                <span className="yaml-help-icon" onClick={e=>e.stopPropagation()}>ℹ</span>
                <div className="yaml-help">{helps.get(path)}</div>
              </>
            )}
            <button
              className="yaml-toggle"
              onClick={e=>{e.stopPropagation();toggle(path);}}
              aria-label={open?"collapse":"expand"}
            >
              {open?"−":"＋"}
            </button>
            <strong className="yaml-tree-key">{k}</strong>
            {isArr&&` [${v.length}]`}
          </div>

          {open&&(()=>{
            const all=isObj
              ?Object.entries(v).map(([ck,cv])=>({key:ck,k:ck,v:cv,path:`${path}.${ck}`}))
              :v.map((item,i)=>({key:i,k:i,v:item,path:`${path}.${i}`}));
            const limited=!showAll.has(path)&&all.length>INITIAL_SHOW;
            const visible=limited?all.slice(0,INITIAL_SHOW):all;
            return(
              <>
                {visible.map(n=>(
                  <Node key={n.key} k={n.k} v={n.v} depth={depth+1} path={n.path}/>
                ))}
                {limited&&(
                  <div style={{paddingLeft:(depth+1)*16,padding:".25rem 0 .25rem "+((depth+1)*16)+"px"}}>
                    <button
                      className="btn-secondary yaml-more-btn"
                      onClick={e=>{e.stopPropagation();revealMore(path);}}
                    >
                      More ({all.length-INITIAL_SHOW} remaining)
                    </button>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      );
    }

    /* primitive ------------------------------------------------- */
    const input=typeof v==="boolean"?(
      <input type="checkbox" checked={v}
             onChange={e=>write(path.split("."),e.target.checked)}/>
    ):(
      <input
        className="yaml-tree-input"
        type={typeof v==="number"?"number":"text"}
        value={v===null?"":v}
        onChange={e=>write(path.split("."),typeof v==="number"?+e.target.value:e.target.value)}
      />
    );

    return(
      <div className={`yaml-tree-block ${depth===0?"root":""}`} style={indent}>
        <div className="yaml-tree-row">
          {helps.has(path)&&(
            <>
              <span className="yaml-help-icon">ℹ</span>
              <div className="yaml-help">{helps.get(path)}</div>
            </>
          )}
          <span className="yaml-toggle-spacer"/>
          <span className="yaml-tree-key">{k}</span>
          {input}
        </div>
      </div>
    );
  };

  /* render root -------------------------------------------------- */
  return(
    <div ref={rootRef}
      style={{
        border:"1px solid var(--border)",borderRadius:6,padding:".6rem 0",
        maxHeight:"52vh",overflowY:"auto",marginBottom:"1.5rem"
      }}>
      {Object.entries(tree).map(([k,v])=>(
        <Node key={k} k={k} v={v} depth={0} path={k}/>
      ))}
    </div>
  );
}
