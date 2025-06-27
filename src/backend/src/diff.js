import { diff } from "deep-object-diff";
import yaml from "js-yaml";

export function deltaYaml(defaultYaml, userYaml) {
  const d = yaml.load(defaultYaml) || {};
  const u = yaml.load(userYaml)    || {};
  return yaml.dump(diff(d, u), { noRefs: true });
}
