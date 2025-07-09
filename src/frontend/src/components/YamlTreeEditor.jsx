/*  YamlTreeEditor.jsx  –  v2
    ───────────────────────────────────────────────────────────────
    Friendly, scroll-safe editor for Helm values.
*/

import React, { useState, useCallback, useMemo, useRef } from "react";
import yaml from "js-yaml";

/* helpers ------------------------------------------------------- */
const clone = o => JSON.parse(JSON.stringify(o));

function extractHelp(src = "") {
  const lines = src.split(/\r?\n/);
  const stack = [];
  const map   = new Map();
  let buf     = [];

  const flush = p => {
    if (!buf.length) return;
    const txt = buf.join(" ").replace(/^--\s*/, "").trim();
    if (txt) map.set(p, txt);
    buf = [];
  };

  lines.forEach(l => {
    const cm = l.match(/^\s*#\s?(.*)/);
    if (cm) { buf.push(cm[1].trim()); return; }

    const km = l.match(/^(\s*)([\w.-]+):/);
    if (!km) { buf = []; return; }

    const depth = km[1].length / 2;
    stack.length = depth;
    stack[depth] = km[2];
    flush(stack.slice(0, depth + 1).join("."));
  });
  return map;
}

/* component ----------------------------------------------------- */
export default function YamlTreeEditor({ yamlText = "", onChange }) {
  /* parse initial YAML */
  const [tree, setTree] = useState(() => {
    try { return yaml.load(yamlText) || {}; }
    catch { return {}; }
  });
  const helps = useMemo(() => extractHelp(yamlText), [yamlText]);

  /* expand / collapse */
  const [expanded, setExp] = useState(new Set());

  const rootRef = useRef(null);          // preserve scroll

  const toggle = useCallback(path => {
    const st = rootRef.current?.scrollTop ?? 0;
    setExp(prev => {
      const n = new Set(prev);
      n.has(path) ? n.delete(path) : n.add(path);
      return n;
    });
    // restore scroll on next paint
    requestAnimationFrame(() => {
      if (rootRef.current) rootRef.current.scrollTop = st;
    });
  }, []);

  /* write helper */
  const write = useCallback((pathArr, val) => {
    const nxt = clone(tree);
    let ptr = nxt;
    pathArr.slice(0, -1).forEach(k => (ptr = ptr[k]));
    ptr[pathArr.at(-1)] = val;
    setTree(nxt);
    onChange?.(yaml.dump(nxt, { noRefs: true }));
  }, [tree, onChange]);

  /* node renderer */
  const Node = ({ k, v, depth, path }) => {
    const indent = { paddingLeft: depth * 16 };
    const isObj  = v && typeof v === "object";
    const isArr  = Array.isArray(v);

    if (isObj && !isArr) {
      const open = expanded.has(path);
      return (
        <div className="yaml-tree-block" style={indent}>
          <button
            className="yaml-toggle"
            onClick={() => toggle(path)}
            aria-label={open ? "collapse" : "expand"}
          >
            {open ? "−" : "＋"}
          </button>
          <strong>{k}</strong>
          {open &&
            Object.entries(v).map(([ck, cv]) => (
              <Node
                key={ck}
                k={ck}
                v={cv}
                depth={depth + 1}
                path={`${path}.${ck}`}
              />
            ))}
          {helps.has(path) && <div className="yaml-help">{helps.get(path)}</div>}
        </div>
      );
    }

    /* primitive */
    const input =
      typeof v === "boolean" ? (
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
      <div className="yaml-tree-block" style={indent}>
        <div className="yaml-tree-row">
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
      }}
    >
      {Object.entries(tree).map(([k, v]) => (
        <Node key={k} k={k} v={v} depth={0} path={k} />
      ))}
    </div>
  );
}
