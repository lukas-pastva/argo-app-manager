#!/usr/bin/env bash
#───────────────────────────────────────────────────────────────────────────────
#  handle-helm-deploy.sh
#  Process JSON from Helm-Toggler and commit the change to Git.
#
#  Requirements:  jq  yq(v4)  git
#───────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ════════════════ CONFIGURE ═══════════════════════════════════════════════════
APPS_DIR="${APPS_DIR:-clusters}"             # 📂 override w/ env var
VALUES_SUBDIR="${VALUES_SUBDIR:-values}"     # 📂 where <release>.yml live
APP_FILE_PATTERN="${APP_FILE_GLOB:-app-of-apps*.y?(a)ml}"
CHARTS_ROOT="charts/external"                # 📂 vendored charts root

PUSH_BRANCH="${PUSH_BRANCH:-main}"           # main | <branch> | new
COMMIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-helm-toggler}"
COMMIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-helm-toggler@local}"

# ════════════════ READ PAYLOAD (all keys start with var_) ═════════════════════
json="$(cat)"
j() { echo "$json" | jq -r "$1 // empty"; }

var_name=$(j .var_name)                          # Application / release name
var_chart=$(j .var_chart)                        # chart (no owner prefix)
var_version=$(j .var_version)
var_namespace=$(j .var_namespace)
var_userValuesYaml=$(j .var_userValuesYaml)      # base-64 encoded overrides

[[ -z $var_chart || -z $var_version || -z $var_namespace || -z $var_userValuesYaml ]] && {
  echo "❌  Missing required var_* fields in webhook" >&2; exit 1; }

release="${var_name:-$var_chart}"                # fallback if var_name omitted
values="$(echo "$var_userValuesYaml" | base64 --decode)"

echo "🚀  Request: $release → $var_namespace  •  $var_chart@$var_version"

# ════════════════ 1) locate / create app-of-apps file ════════════════════════
apps_file=$(find "$APPS_DIR" -type f -name "$APP_FILE_PATTERN" | head -n1)
if [[ -z $apps_file ]]; then
  echo "🆕  Creating new app-of-apps file in $APPS_DIR/"
  apps_file="$APPS_DIR/app-of-apps.yaml"
  mkdir -p "$(dirname "$apps_file")" && touch "$apps_file"
else
  echo "📄  Using app-of-apps file: $apps_file"
fi

# ════════════════ 2) write values file ═══════════════════════════════════════
values_dir="$(dirname "$apps_file")/$VALUES_SUBDIR"
values_file="$values_dir/${release}.yml"
mkdir -p "$values_dir"
echo "$values" > "$values_file"
echo "📝  Wrote values → $values_file"

# ════════════════ 3) build Application YAML ══════════════════════════════════
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

# ════════════════ 4) insert / update in YAML ═════════════════════════════════
if yq 'select(.kind=="Application") | .metadata.name' "$apps_file" \
     | grep -qx "$release"; then
  echo "🔄  Updating existing Application in app-of-apps file"
  yq -i '
    (.[] | select(.kind=="Application" and .metadata.name=="'"$release"'")
    ) = load("'"$app_yaml"'")
  ' "$apps_file"
else
  echo "➕  Appending new Application"
  printf '%s\n---\n' "$app_yaml" >> "$apps_file"
fi

# ════════════════ 5) git add / commit / push ═════════════════════════════════
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

git commit -m "feat: add/update ${release} (${var_namespace}) chart ${var_chart} ${var_version}"
echo "📤  Pushing to origin/$branch_to_push"
git push -u origin "$branch_to_push"

echo "🎉  Done!"
