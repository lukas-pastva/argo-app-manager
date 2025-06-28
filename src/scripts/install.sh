#!/usr/bin/env bash
#───────────────────────────────────────────────────────────────────────────────
#  handle-helm-deploy.sh
#  GitOps helper – create / update an Argo CD Application and commit the change.
#
#  Inputs come from ARGO Workflow parameters, all prefixed with “var_”.
#  Git credentials come from env vars:  GIT_SSH_KEY  GITOPS_REPO  GIT_EMAIL  GIT_USER
#───────────────────────────────────────────────────────────────────────────────
set -Eeuo pipefail
[[ ${DEBUG:-false} == "true" ]] && set -x

# ════════════════ 0) Required ENV vars ════════════════════════════════════════
: "${GIT_SSH_KEY:?env var missing}"
: "${GITOPS_REPO:?env var missing}"
: "${GIT_EMAIL:?env var missing}"
: "${GIT_USER:?env var missing}"

# ════════════════ 1) Workflow parameters (rendered by Argo) ══════════════════
var_name="{{inputs.parameters.var_name}}"
var_chart="{{inputs.parameters.var_chart}}"
var_version="{{inputs.parameters.var_version}}"
var_namespace="{{inputs.parameters.var_namespace}}"
var_userValuesYaml="{{inputs.parameters.var_userValuesYaml}}"   # already *plain* YAML

# ── guard: were they rendered? ────────────────────────────────────────────────
for v in var_name var_chart var_version var_namespace var_userValuesYaml; do
  [[ "${!v}" =~ \{\{.*\}\} ]] && {
    echo "❌  Parameter '$v' not supplied (still '${!v}')" >&2; exit 1; }
done

release="${var_name:-$var_chart}"          # default release name
values="${var_userValuesYaml}"             # ← plain YAML, no base64 decode

echo "🚀  Request: $release → $var_namespace  •  $var_chart@$var_version"

# ════════════════ 2) tmp clone with injected SSH key ═════════════════════════
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

mkdir -p "$workdir/.ssh"
printf '%s\n' "$GIT_SSH_KEY" > "$workdir/.ssh/id_rsa"
chmod 600 "$workdir/.ssh/id_rsa"
export GIT_SSH_COMMAND="ssh -i $workdir/.ssh/id_rsa -o StrictHostKeyChecking=no"

git -C "$workdir" clone --depth 1 "$GITOPS_REPO" repo
cd "$workdir/repo"

# ════════════════ 3) Local config & branch handling ══════════════════════════
git config user.email "$GIT_EMAIL"
git config user.name  "$GIT_USER"

PUSH_BRANCH="${PUSH_BRANCH:-main}"   # allow override

if [[ $PUSH_BRANCH == "new" ]]; then
  branch="helm-${release}-$(date +%Y%m%d%H%M%S)"
  git checkout -b "$branch"
else
  git checkout "$PUSH_BRANCH"
  branch="$PUSH_BRANCH"
fi

# ════════════════ 4) Paths & constants (repo-relative) ═══════════════════════
APPS_DIR="${APPS_DIR:-clusters}"
VALUES_SUBDIR="${VALUES_SUBDIR:-values}"
APP_FILE_PATTERN="${APP_FILE_GLOB:-app-of-apps*.y?(a)ml}"
CHARTS_ROOT="charts/external"

# locate or create app-of-apps YAML
apps_file=$(find "$APPS_DIR" -type f -name "$APP_FILE_PATTERN" | head -n1)
if [[ -z $apps_file ]]; then
  echo "🆕  Creating app-of-apps file in $APPS_DIR/"
  apps_file="$APPS_DIR/app-of-apps.yaml"
  mkdir -p "$(dirname "$apps_file")" && touch "$apps_file"
fi

# write values file
values_dir="$(dirname "$apps_file")/$VALUES_SUBDIR"
values_file="$values_dir/${release}.yml"
mkdir -p "$values_dir"
printf '%s' "$values" > "$values_file"

echo "📝  Values → $values_file"

# ════════════════ 5) Build Application YAML snippet ══════════════════════════
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

# insert / update block
if yq 'select(.kind=="Application") | .metadata.name' "$apps_file" \
     | grep -qx "$release"; then
  echo "🔄  Updating Application in $apps_file"
  yq -i '
    (.[] | select(.kind=="Application" and .metadata.name=="'"$release"'")
    ) = load("'"$app_yaml"'")
  ' "$apps_file"
else
  echo "➕  Appending Application to $apps_file"
  printf '%s\n---\n' "$app_yaml" >> "$apps_file"
fi

# ════════════════ 6) Commit & push ═══════════════════════════════════════════
git add "$apps_file" "$values_file"

if git diff --cached --quiet; then
  echo "ℹ️  No changes – done."
  exit 0
fi

git commit -m "feat(${release}): add/update ${var_chart} ${var_version}"
echo "📤  Pushing to origin/$branch"
git push -u origin "$branch"

echo "🎉  Completed for $release"
