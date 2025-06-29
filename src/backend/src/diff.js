import { diff } from "deep-object-diff";
import yaml from "js-yaml";

/* ------------------------------------------------------------------ */
/*  Recursively turn objects that look like { "0": …, "1": … } into   */
/*  real arrays so js-yaml renders them with “- item” instead of       */
/*  mapping keys '0', '1', …                                           */
/* ------------------------------------------------------------------ */
function objectToArray(node) {
  if (Array.isArray(node)) {
    return node.map(objectToArray);
  }

  if (node && typeof node === "object") {
    const keys = Object.keys(node);
    const allNums = keys.length && keys.every(k => /^\d+$/.test(k));

    if (allNums) {
      const arr = [];
      keys.forEach(k => {
        arr[Number(k)] = objectToArray(node[k]);
      });
      return arr;
    }

    /* normal object – recurse */
    const out = {};
    keys.forEach(k => {
      out[k] = objectToArray(node[k]);
    });
    return out;
  }

  /* primitives – leave untouched */
  return node;
}

/* ------------------------------------------------------------------ */
/*  Compute YAML delta (override-only)                                */
/* ------------------------------------------------------------------ */
export function deltaYaml(defaultYaml = "", userYaml = "") {
  const defObj = yaml.load(defaultYaml) || {};
  const usrObj = yaml.load(userYaml)    || {};

  /* deep diff, then clean arrays */
  const rawDelta = diff(defObj, usrObj);
  const fixed    = objectToArray(rawDelta);

  return yaml.dump(fixed, { noRefs: true });
}
