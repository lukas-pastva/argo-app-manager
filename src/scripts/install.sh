#!/usr/bin/env bash
#───────────────────────────────────────────────────────────────────────────────
#  handle-helm-deploy.sh
#  GitOps helper – create / update an Argo CD Application and commit the change.
#
#  • Designed to be run from an **Argo Workflows** template.
#  • All inputs come in as _parameters_ and are referenced below via
#      {{inputs.parameters.<name>}}   (rendered by Argo at runtime)
#
#  Requirements:  git  yq(v4)  base64
#───────────────────────────────────────────────────────────────────────────────
set -Eeuo pipefail
[[ ${DEBUG:-false} == "true" ]] && set -x               # DEBUG=true → bash -x

# ════════════════ 0) Inputs (Workflow parameters) ════════════════════════════
var_name="{{inputs.parameters.var_name}}"                       # app / release
var_chart="{{inputs.parameters.var_chart}}"                     # chart name
var_version="{{inputs.parameters.var_version}}"                 # chart version
var_namespace="{{inputs.parameters.var_namespace}}"             # k8s namespace
var_userValuesYaml="{{inputs.parameters.var_userValuesYaml}}"   # base-64 string

# ─── guard – fail fast if anything is still unrendered ──────────
for v in var_name var_chart var_version var_namespace var_userValuesYaml; do
  [[ "${!v}" =~ \{\{.*\}\} ]] && {
    echo "❌  Parameter '$v' was not supplied (still '${!v}')"; exit 1; }
done

release="${var_name:-$var_chart}"                # default to chart if missing
values="$(echo "$var_userValuesYaml" | base64 --decode)"

echo "🚀  Request: $release → $var_namespace  •  $var_chart@$var_version"

# ════════════════ CONFIG (overridable via env) ═══════════════════════════════
APPS_DIR="${APPS_DIR:-clusters}"                 # 📂 where app-of-apps YAML lives
VALUES_SUBDIR="${VALUES_SUBDIR:-values}"         # 📂 overrides alongside YAML
APP_FILE_PATTERN="${APP_FILE_GLOB:-app-of-apps*.y?(a)ml}"
CHARTS_ROOT="charts/external"                    # 📂 vendored charts root

PUSH_BRANCH="${PUSH_BRANCH:-main}"               # main | <branch> | new
COMMIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-helm-toggler}"
COMMIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-helm-toggler@local}"

# ════════════════ 1) Locate (or create) app-of-apps file ═════════════════════
apps_file=$(find "$APPS_DIR" -type f -name "$APP_FILE_PATTERN" | head -n1)
if [[ -z $apps_file ]]; then
  echo "🆕  Creating new app-of-apps file in $APPS_DIR/"
  apps_file="$APPS_DIR/app-of-apps.yaml"
  mkdir -p "$(dirname "$apps_file")" && touch "$apps_file"
else
  echo "📄  Using app-of-apps file: $apps_file"
fi

# ════════════════ 2) Write values file (decoded YAML) ════════════════════════
values_dir="$(dirname "$apps_file")/$VALUES_SUBDIR"
values_file="$values_dir/${release}.yml"
mkdir -p "$values_dir"
echo "$values" > "$values_file"
echo "📝  Wrote values → $values_file"

# ════════════════ 3) Build Application YAML fragment ════════════════════════
git_url=$(git remote get-url origin |
          sed -e 's#git@github.com:#https://github.com/#' \
              -e 's#\.git$##')

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
    repoURL: ${git_url}
    path: ${CHARTS_ROOT}/${var_chart}/${var_version}
    targetRevision: ${PUSH_BRANCH}
    helm:
      valueFiles:
        - ../../${VALUES_SUBDIR}/${release}.yml
EOF

# ════════════════ 4) Insert / update in the YAML file ════════════════════════
if yq 'select(.kind=="Application") | .metadata.name' "$apps_file" \
     | grep -qx "$release"; then
  echo "🔄  Updating existing Application"
  yq -i '
    (.[] | select(.kind=="Application" and .metadata.name=="'"$release"'")
    ) = load("'"$app_yaml"'")
  ' "$apps_file"
else
  echo "➕  Appending new Application"
  printf '%s\n---\n' "$app_yaml" >> "$apps_file"
fi

# ════════════════ 5) Git add / commit / push ════════════════════════════════
git add "$apps_file" "$values_file"

chart_dir="${CHARTS_ROOT}/${var_chart}/${var_version}"
if [[ -d $chart_dir ]]; then
  git add "$chart_dir"
  echo "📦  Added existing chart dir $chart_dir"
else
  echo "⚠️   Chart dir $chart_dir not found – skipped"
fi

if git diff --cached --quiet; then
  echo "💡  No git changes detected – exiting."
  exit 0
fi

git config user.email "$COMMIT_AUTHOR_EMAIL"
git config user.name  "$COMMIT_AUTHOR_NAME"

if [[ $PUSH_BRANCH == "new" ]]; then
  new_branch="helm-${release}-$(date +%Y%m%d%H%M%S)"
  git checkout -b "$new_branch"
  branch_to_push="$new_branch"
  echo "🌱  Created branch $branch_to_push"
else
  git checkout "$PUSH_BRANCH"
  branch_to_push="$PUSH_BRANCH"
  echo "🌿  Using branch $branch_to_push"
fi

git commit -m "feat(${release}): bump to ${var_chart} ${var_version}"
echo "📤  Pushing to origin/$branch_to_push"
git push -u origin "$branch_to_push"

echo "🎉  Done!"
