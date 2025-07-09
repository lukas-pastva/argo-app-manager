/*  YamlTreeEditor.jsx
    ───────────────────────────────────────────────────────────────
    A minimal, dependency-free “friendly” editor that turns a YAML
    document into an expandable tree of form inputs.

      • Objects    → collapsible nodes with “＋ / −” toggles
      • booleans   → check-boxes
      • numbers    → <input type="number">
      • strings    → plain text inputs

    All edits are immediately emitted as fresh YAML via onChange().
*/

import React, { useState, useCallback } from "react";
import yaml from "js-yaml";

/* ─── helpers ─────────────────────────────────────────────────── */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/* ─────────────────────────────────────────────────────────────── */
export default function YamlTreeEditor({ yamlText = "", onChange }) {
  /* state ------------------------------------------------------- */
  const [tree, setTree] = useState(() => {
    try {
      return yaml.load(yamlText) || {};
    } catch {
      return {};
    }
  });
  const [expanded, setExpanded] = useState(new Set());

  /* toggle expand/collapse ------------------------------------- */
  const toggle = useCallback(path => {
    setExpanded(prev => {
      const nxt = new Set(prev);
      nxt.has(path) ? nxt.delete(path) : nxt.add(path);
      return nxt;
    });
  }, []);

  /* write helper ------------------------------------------------ */
  const write = useCallback((pathArr, value) => {
    const next = deepClone(tree);
    let ptr = next;
    for (let i = 0; i < pathArr.length - 1; i++) {
      ptr = ptr[pathArr[i]];
    }
    ptr[pathArr.at(-1)] = value;
    setTree(next);
    onChange?.(yaml.dump(next, { noRefs: true }));
  }, [tree, onChange]);

  /* recursive node --------------------------------------------- */
  const Node = ({ k, v, depth, path }) => {
    const indent = { paddingLeft: depth * 16 };
    const isObj  = v && typeof v === "object" && !Array.isArray(v);
    const open   = expanded.has(path);

    if (isObj) {
      return (
        <div style={{ ...indent, margin: ".1rem 0" }}>
          <button
            onClick={() => toggle(path)}
            style={{
              width: 18, cursor: "pointer", border: "none",
              background: "transparent", lineHeight: 1,
            }}
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
        </div>
      );
    }

    /* primitives ------------------------------------------------ */
    const inputProps = {
      style: { flex: "1 1 auto", padding: ".25rem .5rem" },
    };

    return (
      <div
        style={{
          ...indent,
          display: "flex",
          alignItems: "center",
          gap: ".4rem",
          margin: ".1rem 0",
        }}
      >
        <span>{k}</span>
        {typeof v === "boolean" ? (
          <input
            type="checkbox"
            checked={v}
            onChange={e => write(path.split("."), e.target.checked)}
          />
        ) : (
          <input
            {...inputProps}
            type={typeof v === "number" ? "number" : "text"}
            value={v}
            onChange={e =>
              write(
                path.split("."),
                typeof v === "number" ? +e.target.value : e.target.value,
              )
            }
          />
        )}
      </div>
    );
  };

  /* render ------------------------------------------------------ */
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: ".5rem 0",
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
