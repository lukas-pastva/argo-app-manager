#!/usr/bin/env bash
#───────────────────────────────────────────────────────────────────────────────
#  handle-helm-deploy.sh
#  GitOps helper – create / update an Argo CD Application and commit the change.
#───────────────────────────────────────────────────────────────────────────────
set -Eeuo pipefail
[[ ${DEBUG:-false} == "true" ]] && set -x

# ════════════════ REQUIRED ENV VARS ═══════════════════════════════════════════
: "${GIT_SSH_KEY:?env var missing}"
: "${GITOPS_REPO:?env var missing}"
: "${GIT_EMAIL:?env var missing}"
: "${GIT_USER:?env var missing}"

# ════════════════ WORKFLOW PARAMETERS (Argo renders these) ════════════════════
var_name="{{inputs.parameters.var_name}}"
var_chart="{{inputs.parameters.var_chart}}"
var_version="{{inputs.parameters.var_version}}"
var_namespace="{{inputs.parameters.var_namespace}}"
var_userValuesYaml="{{inputs.parameters.var_userValuesYaml}}"

for v in var_name var_chart var_version var_namespace var_userValuesYaml; do
  [[ "${!v}" =~ \{\{.*\}\} ]] && {
    echo "❌  Parameter '$v' not supplied (still '${!v}')" >&2; exit 1; }
done

release="${var_name:-$var_chart}"
values="${var_userValuesYaml}"

echo "🚀  Request: $release → $var_namespace • $var_chart@$var_version"

# ════════════════ CONFIG (new defaults / overrides) ═══════════════════════════
APPS_DIR="${APPS_DIR:-.}"                     # ← defaults to repo root
APP_FILE_NAME="${APP_FILE_NAME:-app-of-apps.yaml}"   # NEW (env-overridable)
VALUES_SUBDIR="${VALUES_SUBDIR:-values}"
CHARTS_ROOT="charts/external"
PUSH_BRANCH="${PUSH_BRANCH:-main}"

# ════════════════ TEMP CLONE WITH SSH KEY ════════════════════════════════════
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

mkdir -p "$workdir/.ssh"
printf '%s\n' "$GIT_SSH_KEY" > "$workdir/.ssh/id_rsa"
chmod 600 "$workdir/.ssh/id_rsa"
export GIT_SSH_COMMAND="ssh -i $workdir/.ssh/id_rsa -o StrictHostKeyChecking=no"

git -C "$workdir" clone --depth 1 "$GITOPS_REPO" repo
cd "$workdir/repo"

git config user.email "$GIT_EMAIL"
git config user.name  "$GIT_USER"

if [[ $PUSH_BRANCH == "new" ]]; then
  branch="helm-${release}-$(date +%Y%m%d%H%M%S)"
  git checkout -b "$branch"
else
  git checkout "$PUSH_BRANCH"
  branch="$PUSH_BRANCH"
fi

# ════════════════ PATHS / FILES ══════════════════════════════════════════════
apps_file="$APPS_DIR/$APP_FILE_NAME"
[[ -f $apps_file ]] || { echo "🆕  Creating $apps_file"; mkdir -p "$(dirname "$apps_file")"; touch "$apps_file"; }

values_dir="$(dirname "$apps_file")/$VALUES_SUBDIR"
values_file="$values_dir/${release}.yml"
mkdir -p "$values_dir"
printf '%s' "$values" > "$values_file"
echo "📝  Values → $values_file"

# ════════════════ BUILD Application YAML ═════════════════════════════════════
read -r -d '' app_yaml <<EOF
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: ${release}
spec:
  project: default
  destination:
    server: https://kubernetes.default.svc
    namespace: ${var_namespace}
  source:
    repoURL: $(echo "$GITOPS_REPO" | sed 's#^git@github.com:#https://github.com/#; s#\.git$##')
    path: ${CHARTS_ROOT}/${var_chart}/${var_version}
    targetRevision: ${branch}
    helm:
      valueFiles:
        - ../../${VALUES_SUBDIR}/${release}.yml
EOF

# insert / update in app-of-apps file
if yq 'select(.kind=="Application") | .metadata.name' "$apps_file" | grep -qx "$release"; then
  echo "🔄  Updating ${release} entry"
  yq -i '(.[] | select(.kind=="Application" and .metadata.name=="'"$release"'")) = load("'"$app_yaml"'")' "$apps_file"
else
  echo "➕  Adding ${release}"
  printf '%s\n---\n' "$app_yaml" >> "$apps_file"
fi

# ════════════════ COMMIT & PUSH ══════════════════════════════════════════════
git add "$apps_file" "$values_file"

if git diff --cached --quiet; then
  echo "ℹ️  No changes – done."; exit 0
fi

git commit -m "feat(${release}): add/update ${var_chart} ${var_version}"
echo "📤  Pushing to origin/$branch"
git push -u origin "$branch"

echo "🎉  Completed for $release"
