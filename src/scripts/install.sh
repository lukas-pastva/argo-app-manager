#!/usr/bin/env bash
#───────────────────────────────────────────────────────────────────────────────
#  install.sh   –   v2.10  (owner-aware chart cache layout)
#───────────────────────────────────────────────────────────────────────────────
set -Eeuo pipefail
[[ ${DEBUG:-false} == "true" ]] && set -x

log() { printf '\e[1;34m[%(%F %T)T]\e[0m %b\n' -1 "$*" >&2; }
trap 'log "❌  FAILED (line $LINENO) 👉 «$BASH_COMMAND»"; exit 1' ERR
echo -e "\n\e[1;33m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\e[0m"

###############################################################################
# 0) Workflow inputs
###############################################################################
var_release="{{inputs.parameters.var_release}}"
var_name="{{inputs.parameters.var_name}}"
var_chart="{{inputs.parameters.var_chart}}"
var_version="{{inputs.parameters.var_version}}"
var_namespace="{{inputs.parameters.var_namespace}}"
var_repo="{{inputs.parameters.var_repo}}"
var_userValuesYaml="{{inputs.parameters.var_userValuesYaml}}"
var_owner="{{inputs.parameters.var_owner}}"

for p in var_release var_name var_chart var_version var_namespace var_repo \
         var_userValuesYaml; do
  [[ ${!p} =~ \{\{.*\}\} ]] && { log "🚫  $p not substituted – abort"; exit 1; }
done

log "🚀  Request:"
log "    • release    = ${var_release}"
log "    • name(app)  = ${var_name}"
log "    • namespace  = ${var_namespace}"
log "    • chart      = ${var_chart}@${var_version}"
log "    • helm repo  = ${var_repo}"
log "    • owner      = ${var_owner}"
log "    • values     = $(printf '%s' "${var_userValuesYaml}" | wc -c) bytes"

###############################################################################
# 1) Mandatory env
###############################################################################
: "${GIT_SSH_KEY:?need GIT_SSH_KEY}"
: "${GITOPS_REPO:?need GITOPS_REPO}"
: "${GIT_EMAIL:?need GIT_EMAIL}"
: "${GIT_USER:?need GIT_USER}"

log "🔑  Git user:    $GIT_USER <$GIT_EMAIL>"
log "🌐  GitOps repo: $GITOPS_REPO"

###############################################################################
# 2) Paths
###############################################################################
APPS_DIR="${APPS_DIR:-.}"
APP_FILE_NAME="${APP_FILE_NAME:-app-of-apps.yaml}"
VALUES_SUBDIR="${VALUES_SUBDIR:-values}"
PUSH_BRANCH="${PUSH_BRANCH:-main}"

apps_file="${APPS_DIR}/${APP_FILE_NAME}"
values_file="${VALUES_SUBDIR}/${var_release}.yaml"
chart_path="charts/external/${var_owner}/${var_chart}/${var_version}"

log "📁  Paths:"
log "    • apps_file   = ${apps_file}"
log "    • values_file = ${values_file}"
log "    • chart_path  = ${chart_path}"

###############################################################################
# 3) Clone repo
###############################################################################
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
log "🐙  Cloning into ${tmp} …"

mkdir -p "$tmp/.ssh"
printf '%s\n' "$GIT_SSH_KEY" > "$tmp/.ssh/id_rsa"
chmod 600 "$tmp/.ssh/id_rsa"
export GIT_SSH_COMMAND="ssh -i $tmp/.ssh/id_rsa -o StrictHostKeyChecking=no"

git -C "$tmp" clone --depth 1 "$GITOPS_REPO" repo
cd "$tmp/repo"

git config user.email "$GIT_EMAIL"
git config user.name  "$GIT_USER"

if [[ $PUSH_BRANCH == "new" ]]; then
  branch="helm-${var_release}-$(date +%Y%m%d%H%M%S)"
  git checkout -b "$branch"
else
  git checkout "$PUSH_BRANCH"
  branch="$PUSH_BRANCH"
fi
log "🌿  Using branch \e[1m$branch\e[0m"

###############################################################################
# 4) Write values file
###############################################################################
mkdir -p "$(dirname "$apps_file")"
[[ -f $apps_file ]] || { echo 'appProjects: []' > "$apps_file"; log "🆕  Created $apps_file"; }

mkdir -p "$(dirname "$values_file")"
printf '%s\n' "$var_userValuesYaml" > "$values_file"
log "📝  Values → $values_file"

###############################################################################
# 5) Download Helm chart
###############################################################################
if [[ -d $chart_path ]]; then
  log "📦  Chart already cached → $chart_path"
else
  log "⬇️   helm pull → $chart_path"
  tempc="$(mktemp -d)"
  helm pull "${var_chart}" --repo "${var_repo}" --version "${var_version}" -d "$tempc" > /dev/null
  tar -xzf "$tempc/${var_chart}-${var_version}.tgz" -C "$tempc"
  mkdir -p "$chart_path"
  mv "$tempc/${var_chart}/"* "$chart_path/"
  rm -rf "$tempc"
  log "✅  Chart extracted"
fi

###############################################################################
# 6) Upsert Application block via yq (v4)
###############################################################################
command -v yq >/dev/null || { log "❌  yq v4 required"; exit 1; }
log "🛠  yq version: $(yq --version)"

export VAR_NAME="${var_name}"
export CHART_PATH="external/${var_owner}/${var_chart}/${var_version}"
export GITOPS_REPO

yq_filter='.appProjects = (.appProjects // []) |
  (.appProjects) |= map(select(.name != env(VAR_NAME))) |
  .appProjects += [{
    "name": env(VAR_NAME),
    "applications": [{
      "name":       env(VAR_NAME),
      "repoURL":    env(GITOPS_REPO),
      "path":       env(CHART_PATH),
      "autoSync":   true,
      "valueFiles": true
    }]
  }]'

log "🔧  yq filter: ${yq_filter}"
yq eval -i "$yq_filter" "$apps_file"

###############################################################################
# 7) Commit & push
###############################################################################
git add "$apps_file" "$values_file" "$chart_path"
git status --short

if git diff --cached --quiet; then
  log "ℹ️  No change — exiting."
  exit 0
fi

git commit -m "feat(${var_name}): add/update ${var_chart} ${var_version}"
log "📤  Pushing…"
git push -u origin "$branch"

log "🎉  Done – Application \e[1m${var_name}\e[0m committed!"
echo -e "\e[1;32m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\e[0m\n"
