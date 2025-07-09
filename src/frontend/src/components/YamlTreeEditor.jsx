/*  YamlTreeEditor.jsx
    ───────────────────────────────────────────────────────────────
    Graphical **“Friendly UX”** editor for Helm values.

    ✦  Objects & arrays are expandable (＋ / −)  
    ✦  Type-aware inputs  – checkbox | number | text  
    ✦  **Help-hints** – reads “# …” comments that sit *immediately
       above* a key and shows them next to the field  
    ✦  No new deps – uses existing `js-yaml`
*/

import React, { useState, useCallback, useMemo } from "react";
import yaml from "js-yaml";

/* ── shallow helpers ─────────────────────────────────────────── */
const clone  = o => JSON.parse(JSON.stringify(o));

/* Parse comments that live right above a key
   (assumes 2-space indent like most charts)                      */
function extractHelp(src = "") {
  const lines  = src.split(/\r?\n/);
  const stack  = [];
  const help   = new Map();
  let   buffer = [];

  const flush = path => {
    if (!buffer.length) return;
    const txt = buffer.join(" ").replace(/^--\s*/, "").trim();
    if (txt) help.set(path, txt);
    buffer = [];
  };

  lines.forEach(l => {
    const cm = l.match(/^\s*#\s?(.*)/);
    if (cm) { buffer.push(cm[1].trim()); return; }

    const km = l.match(/^(\s*)([\w.-]+):/);
    if (!km) { buffer = []; return; }

    const depth = km[1].length / 2;      // 2-space indent
    stack.length = depth;
    stack[depth] = km[2];

    flush(stack.slice(0, depth + 1).join("."));
  });
  return help;
}

/* ────────────────────────────────────────────────────────────── */
export default function YamlTreeEditor({ yamlText = "", onChange }) {

  /* ⇢ parse YAML ------------------------------------------------ */
  const [tree, setTree] = useState(() => {
    try { return yaml.load(yamlText) || {}; }
    catch { return {}; }
  });

  /* ⇢ pick up help comments once -------------------------------- */
  const helps = useMemo(() => extractHelp(yamlText), [yamlText]);

  /* ⇢ expand / collapse state ---------------------------------- */
  const [expanded, setExp] = useState(new Set());
  const toggle = useCallback(p => {
    setExp(s => {
      const n = new Set(s);
      n.has(p) ? n.delete(p) : n.add(p);
      return n;
    });
  }, []);

  /* ⇢ write helper --------------------------------------------- */
  const write = useCallback((pathArr, val) => {
    const nxt  = clone(tree);
    let ptr    = nxt;
    pathArr.slice(0, -1).forEach(k => { ptr = ptr[k]; });
    ptr[pathArr.at(-1)] = val;
    setTree(nxt);
    onChange?.(yaml.dump(nxt, { noRefs: true }));
  }, [tree, onChange]);

  /* ⇢ render node ---------------------------------------------- */
  const Node = ({ k, v, depth, path }) => {
    const indent = { paddingLeft: depth * 16 };
    const isObj  = v && typeof v === "object" && !Array.isArray(v);
    const isArr  = Array.isArray(v);

    /* ── objects / arrays ───────────────────────────────────── */
    if (isObj || isArr) {
      const open = expanded.has(path);
      return (
        <div style={{ ...indent, margin: ".25rem 0" }}>
          <button
            onClick={() => toggle(path)}
            style={{ width: 18, border: "none", background: "transparent",
                     cursor: "pointer", lineHeight: 1 }}
            aria-label={open ? "collapse" : "expand"}
          >
            {open ? "−" : "＋"}
          </button>
          <strong>{k}</strong>
          {isArr && `  [${v.length}]`}
          {helps.has(path) && <div className="yaml-help">{helps.get(path)}</div>}
          {open && (
            isObj
              ? Object.entries(v).map(([ck, cv]) => (
                  <Node key={ck} k={ck} v={cv} depth={depth + 1}
                        path={`${path}.${ck}`} />
                ))
              : v.map((item, i) => (
                  <Node key={i} k={i} v={item} depth={depth + 1}
                        path={`${path}.${i}`} />
                ))
          )}
        </div>
      );
    }

    /* ── scalars ------------------------------------------------ */
    const input =
      typeof v === "boolean" ? (
        <input type="checkbox" checked={v}
               onChange={e => write(path.split("."), e.target.checked)} />
      ) : (
        <input
          className="yaml-tree-input"
          type={typeof v === "number" ? "number" : "text"}
          value={v === null ? "" : v}
          onChange={e =>
            write(
              path.split("."),
              typeof v === "number" ? +e.target.value : e.target.value
            )}
        />
      );

    return (
      <div className="yaml-tree-row" style={indent}>
        <span className="yaml-tree-key">{k}</span>
        {input}
        {helps.has(path) && <span className="yaml-help">{helps.get(path)}</span>}
      </div>
    );
  };

  /* ── render root -------------------------------------------- */
  return (
    <div style={{
      border: "1px solid var(--border)",
      borderRadius: 6,
      padding: ".5rem 0",
      maxHeight: "52vh",
      overflowY: "auto"
    }}>
      {Object.entries(tree).map(([k, v]) => (
        <Node key={k} k={k} v={v} depth={0} path={k} />
      ))}
    </div>
  );
}
