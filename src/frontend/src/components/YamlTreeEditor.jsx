/*  YamlTreeEditor.jsx  –  v3
    Friendly, scroll-safe form editor for Helm values.
*/

import React, { useState, useCallback, useMemo, useRef } from "react";
import yaml from "js-yaml";

/* helpers ------------------------------------------------------ */
const clone = o => JSON.parse(JSON.stringify(o));

function extractHelp(src = "") {
  const lines = src.split(/\r?\n/);
  const stack = [];
  const map   = new Map();
  let buf     = [];

  const flush = p => {
    if (!buf.length) return;
    const t = buf.join(" ").replace(/^--\s*/, "").trim();
    if (t) map.set(p, t);
    buf = [];
  };

  lines.forEach(l => {
    const cm = l.match(/^\s*#\s?(.*)/);
    if (cm) { buf.push(cm[1].trim()); return; }

    const km = l.match(/^(\s*)([\w.-]+):/);
    if (!km) { buf = []; return; }

    const d = km[1].length / 2;
    stack.length = d;
    stack[d] = km[2];
    flush(stack.slice(0, d + 1).join("."));
  });
  return map;
}

/* component ---------------------------------------------------- */
export default function YamlTreeEditor({ yamlText = "", onChange }) {
  /* parse once */
  const [tree, setTree] = useState(() => {
    try { return yaml.load(yamlText) || {}; }
    catch { return {}; }
  });
  const helps = useMemo(() => extractHelp(yamlText), [yamlText]);

  /* expand / collapse state */
  const [expanded, setExp] = useState(new Set());
  const rootRef = useRef(null);

  const toggle = useCallback(p => {
    const st = rootRef.current?.scrollTop || 0;
    setExp(s => {
      const n = new Set(s);
      n.has(p) ? n.delete(p) : n.add(p);
      return n;
    });
    requestAnimationFrame(() => {
      if (rootRef.current) rootRef.current.scrollTop = st;
    });
  }, []);

  const write = useCallback((arr, val) => {
    const nxt = clone(tree);
    let ptr = nxt;
    arr.slice(0, -1).forEach(k => (ptr = ptr[k]));
    ptr[arr.at(-1)] = val;
    setTree(nxt);
    onChange?.(yaml.dump(nxt, { noRefs: true }));
  }, [tree, onChange]);

  /* node renderer */
  const Node = ({ k, v, depth, path }) => {
    const indent = { paddingLeft: depth * 16 };
    const isObj  = v && typeof v === "object" && !Array.isArray(v);

    if (isObj) {
      const open = expanded.has(path);
      return (
        <div className={`yaml-tree-block ${depth === 0 ? "root" : ""}`} style={indent}>
          <button className="yaml-toggle" onClick={() => toggle(path)}
                  aria-label={open ? "collapse" : "expand"}>{open ? "−" : "＋"}</button>
          <strong className="yaml-tree-key">{k}</strong>
          {open &&
            Object.entries(v).map(([ck, cv]) => (
              <Node key={ck} k={ck} v={cv} depth={depth + 1} path={`${path}.${ck}`} />
            ))}
          {helps.has(path) && <div className="yaml-help">{helps.get(path)}</div>}
        </div>
      );
    }

    /* primitive */
    const input = typeof v === "boolean" ? (
      <input
        type="checkbox"
        checked={v}
        onChange={e => write(path.split("."), e.target.checked)}
      />
    ) : (
      <input
        className="yaml-tree-input"
        type={typeof v === "number" ? "number" : "text"}
        value={v === null ? "" : v}
        onChange={e =>
          write(
            path.split("."),
            typeof v === "number" ? +e.target.value : e.target.value,
          )
        }
      />
    );

    return (
      <div className={`yaml-tree-block ${depth === 0 ? "root" : ""}`} style={indent}>
        <div className="yaml-tree-row">
          <span className="yaml-toggle-spacer" />
          <span className="yaml-tree-key">{k}</span>
          {input}
        </div>
        {helps.has(path) && <div className="yaml-help">{helps.get(path)}</div>}
      </div>
    );
  };

  /* render root */
  return (
    <div
      ref={rootRef}
      style={{
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: ".6rem 0",
        maxHeight: "52vh",
        overflowY: "auto",
        marginBottom: "1.5rem",      /* space before Install button */
      }}
    >
      {Object.entries(tree).map(([k, v]) => (
        <Node key={k} k={k} v={v} depth={0} path={k} />
      ))}
    </div>
  );
}
