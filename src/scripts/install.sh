#!/usr/bin/env bash
#───────────────────────────────────────────────────────────────────────────────
#  handle-helm-deploy.sh  –  v2  (extra-verbose)
#───────────────────────────────────────────────────────────────────────────────
set -Eeuo pipefail
[[ ${DEBUG:-false} == "true" ]] && set -x     # DEBUG=true → bash -x

# ─── coloured timestamped logger ──────────────────────────────────────────────
log() { printf '\e[1;34m[%(%F %T)T]\e[0m %b\n' -1 "$*" >&2; }
trap 'log "❌  FAILED  (line $LINENO) 👉  «$BASH_COMMAND»"; exit 1' ERR

echo -e "\n\e[1;33m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\e[0m"

###############################################################################
# 0) Inputs from the Workflow template (Argo will substitute these)
###############################################################################
var_name="{{inputs.parameters.var_name}}"
var_chart="{{inputs.parameters.var_chart}}"
var_version="{{inputs.parameters.var_version}}"
var_namespace="{{inputs.parameters.var_namespace}}"
var_userValuesYaml="{{inputs.parameters.var_userValuesYaml}}"

for p in var_name var_chart var_version var_namespace var_userValuesYaml; do
  [[ "${!p}" =~ \{\{.*\}\} ]] && {
    log "🚫  Parameter $p not substituted – aborting"; exit 1; }
done

release="${var_name:-$var_chart}"
values_yaml="${var_userValuesYaml}"
log "🚀  Request:   app=\e[1m${release}\e[0m  ns=${var_namespace}  •  \
chart=${var_chart}@${var_version}"

###############################################################################
# 1) Mandatory env-vars
###############################################################################
: "${GIT_SSH_KEY:?need GIT_SSH_KEY}"
: "${GITOPS_REPO:?need GITOPS_REPO}"
: "${GIT_EMAIL:?need GIT_EMAIL}"
: "${GIT_USER:?need GIT_USER}"

log "🔑  Git user:  $GIT_USER <$GIT_EMAIL>"
log "🌐  Repo:      $GITOPS_REPO"

#####################!/usr/bin/env bash
#───────────────────────────────────────────────────────────────────────────────
#  handle-helm-deploy.sh  –  v2.5  (repoURL-fix)
#───────────────────────────────────────────────────────────────────────────────
set -Eeuo pipefail
[[ ${DEBUG:-false} == "true" ]] && set -x

log() { printf '\e[1;34m[%(%F %T)T]\e[0m %b\n' -1 "$*" >&2; }
trap 'log "❌  FAILED  (line $LINENO) 👉  «$BASH_COMMAND»"; exit 1' ERR

echo -e "\n\e[1;33m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\e[0m"

###############################################################################
# 0) Template inputs  – ALL mandatory
###############################################################################
var_name="{{inputs.parameters.var_name}}"
var_chart="{{inputs.parameters.var_chart}}"
var_version="{{inputs.parameters.var_version}}"
var_namespace="{{inputs.parameters.var_namespace}}"
var_userValuesYaml="{{inputs.parameters.var_userValuesYaml}}"
var_repo="{{inputs.parameters.var_repo}}"          # Helm-chart repo URL

for p in var_name var_chart var_version var_namespace var_userValuesYaml var_repo
do
  [[ "${!p}" =~ \{\{.*\}\} ]] && { log "🚫  $p not substituted – aborting"; exit 1; }
done

release="${var_name:-$var_chart}"
values_yaml="${var_userValuesYaml}"

log "🚀  Request:   app=\e[1m${release}\e[0m  ns=${var_namespace}  •  \
chart=${var_chart}@${var_version}"
log "📦  Helm repo for download: ${var_repo}"

###############################################################################
# 1) Environment – all required
###############################################################################
: "${GIT_SSH_KEY:?need GIT_SSH_KEY}"
: "${GITOPS_REPO:?need GITOPS_REPO}"       # ← will become repoURL in Application
: "${GIT_EMAIL:?need GIT_EMAIL}"
: "${GIT_USER:?need GIT_USER}"

log "🔑  Git user:      $GIT_USER <$GIT_EMAIL>"
log "🌐  GitOps repo:   $GITOPS_REPO"

###############################################################################
# 2) Defaults / paths
###############################################################################
APPS_DIR="${APPS_DIR:-.}"
APP_FILE_NAME="${APP_FILE_NAME:-app-of-apps.yaml}"
VALUES_SUBDIR="${VALUES_SUBDIR:-values}"
CHARTS_ROOT="external"
PUSH_BRANCH="${PUSH_BRANCH:-main}"

log "📁  Paths:"
log "    • apps_file   = ${APPS_DIR}/${APP_FILE_NAME}"
log "    • values_file = ${VALUES_SUBDIR}/${release}.yml"
log "    • chart_path  = ${CHARTS_ROOT}/${var_chart}/${var_chart}/${var_version}"

###############################################################################
# 3) Clone GitOps repo
###############################################################################
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
log "🐙  Cloning into $tmp …"
mkdir -p "$tmp/.ssh"
printf '%s\n' "$GIT_SSH_KEY" > "$tmp/.ssh/id_rsa"
chmod 600 "$tmp/.ssh/id_rsa"
export GIT_SSH_COMMAND="ssh -i $tmp/.ssh/id_rsa -o StrictHostKeyChecking=no"

git -C "$tmp" clone --depth 1 "$GITOPS_REPO" repo
cd "$tmp/repo"

git config user.email "$GIT_EMAIL"
git config user.name  "$GIT_USER"

if [[ $PUSH_BRANCH == "new" ]]; then
  branch="helm-${release}-$(date +%Y%m%d%H%M%S)"
  git checkout -b "$branch"
else
  git checkout "$PUSH_BRANCH"
  branch="$PUSH_BRANCH"
fi
log "🌿  Using branch \e[1m$branch\e[0m"

###############################################################################
# 4) Prepare YAML & values files
###############################################################################
apps_file="$APPS_DIR/$APP_FILE_NAME"
mkdir -p "$(dirname "$apps_file")"
[[ -f $apps_file ]] || { echo 'appProjects: []' > "$apps_file"; \
                          log "🆕  Created $apps_file"; }

values_dir="$(dirname "$apps_file")/$VALUES_SUBDIR"
values_file="$values_dir/${release}.yml"
mkdir -p "$values_dir"
printf '%s\n' "$values_yaml" > "$values_file"
log "📝  Values → $values_file  (size: $(wc -c <"$values_file") bytes)"

chart_path="${CHARTS_ROOT}/${var_chart}/${var_chart}/${var_version}"

###############################################################################
# 5) Download chart  (using var_repo only)
###############################################################################
if [[ -d $chart_path ]]; then
  log "📦  Chart cached → $chart_path"
else
  log "⬇️   helm pull → $chart_path"
  tempc="$(mktemp -d)"
  helm pull "${var_repo}/${var_chart}" --version "$var_version" -d "$tempc" >/dev/null
  tar -xzf "$tempc/${var_chart}-${var_version}.tgz" -C "$tempc"
  mkdir -p "$chart_path"
  mv "$tempc/${var_chart}/"* "$chart_path/"
  rm -rf "$tempc"
  log "✅  Chart extracted"
fi

###############################################################################
# 6) Upsert Application block   (repoURL = GITOPS_REPO)
###############################################################################
command -v yq >/dev/null || { log "❌  yq v4 missing"; exit 1; }

log "🔧  Updating Application in $apps_file"
yq -i '
  .appProjects as $p
  | (index($p[]?; .name == "'"$release"'")) as $idx
  | if $idx == "" then
      .appProjects += [{
        name: "'"$release"'",
        applications: [{
          name: "'"$release"'",
          repoURL: "'"$GITOPS_REPO"'",
          path: "'"$chart_path"'",
          autoSync: true,
          valueFiles: true
        }]}
    ]
    else
      .appProjects[$idx].applications[0] = {
        name: "'"$release"'",
        repoURL: "'"$GITOPS_REPO"'",
        path: "'"$chart_path"'",
        autoSync: true,
        valueFiles: true
      }
    end
' "$apps_file"

log "🗎  New entry preview:"
yq '.appProjects[] | select(.name=="'"$release"'")' "$apps_file"

###############################################################################
# 7) Commit & push
###############################################################################
git add "$apps_file" "$values_file" "$chart_path"
log "🔍  git status:"
git status --short

if git diff --cached --quiet; then
  log "ℹ️  No changes to push."
  exit 0
fi

git commit -m "feat(${release}): add / update ${var_chart} ${var_version}"
log "📤  Pushing…"
git push -u origin "$branch"

log "🎉  Done – application \e[1m${release}\e[0m ready!"
echo -e "\e[1;32m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\e[0m\n"
###########################################################
# 2) Configurable paths / defaults
###############################################################################
APPS_DIR="${APPS_DIR:-.}"
APP_FILE_NAME="${APP_FILE_NAME:-app-of-apps.yaml}"
VALUES_SUBDIR="${VALUES_SUBDIR:-values}"
CHARTS_ROOT="external"
PUSH_BRANCH="${PUSH_BRANCH:-main}"
HELM_REPO_URL="${HELM_REPO_URL:-git@gitlab.com:tronic-sk/helm-charts.git}"

log "📁  Paths:"
log "    • apps_file   = ${APPS_DIR}/${APP_FILE_NAME}"
log "    • values_file = ${VALUES_SUBDIR}/${release}.yml"
log "    • chart_path  = ${CHARTS_ROOT}/${var_chart}/${var_chart}/${var_version}"

###############################################################################
# 3) Clone GitOps repo
###############################################################################
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
log "🐙  Cloning repo into $tmp …"
mkdir -p "$tmp/.ssh"
printf '%s\n' "$GIT_SSH_KEY" > "$tmp/.ssh/id_rsa"
chmod 600 "$tmp/.ssh/id_rsa"
export GIT_SSH_COMMAND="ssh -i $tmp/.ssh/id_rsa -o StrictHostKeyChecking=no"

git -C "$tmp" clone --depth 1 "$GITOPS_REPO" repo
cd "$tmp/repo"

git config user.email "$GIT_EMAIL"
git config user.name  "$GIT_USER"

if [[ $PUSH_BRANCH == "new" ]]; then
  branch="helm-${release}-$(date +%Y%m%d%H%M%S)"
  git checkout -b "$branch"
else
  git checkout "$PUSH_BRANCH"
  branch="$PUSH_BRANCH"
fi
log "🌿  Checked-out branch \e[1m$branch\e[0m"

###############################################################################
# 4) Prepare files & directories
###############################################################################
apps_file="$APPS_DIR/$APP_FILE_NAME"
mkdir -p "$(dirname "$apps_file")"
[[ -f $apps_file ]] || { echo 'appProjects: []' > "$apps_file"; \
                          log "🆕  Created $apps_file"; }

values_dir="$(dirname "$apps_file")/$VALUES_SUBDIR"
values_file="$values_dir/${release}.yml"
mkdir -p "$values_dir"
printf '%s\n' "$values_yaml" > "$values_file"
log "📝  Wrote values → $values_file  (size: $(wc -c <"$values_file") bytes)"

chart_path="${CHARTS_ROOT}/${var_chart}/${var_chart}/${var_version}"

###############################################################################
# 5) Pull chart (if cache miss)
###############################################################################
if [[ -d $chart_path ]]; then
  log "📦  Chart already cached → $chart_path"
else
  log "⬇️   Pulling chart to $chart_path"
  tempc="$(mktemp -d)"
  helm pull "${HELM_REPO_URL}/${var_chart}" --version "$var_version" -d "$tempc" >/dev/null
  tar -xzf "$tempc/${var_chart}-${var_version}.tgz" -C "$tempc"
  mkdir -p "$chart_path"
  mv "$tempc/${var_chart}/"* "$chart_path/"
  rm -rf "$tempc"
  log "✅  Chart extracted"
fi

###############################################################################
# 6) Upsert Application entry via yq
###############################################################################
if ! command -v yq >/dev/null; then
  log "❌  yq v4 not found – install it in the container"; exit 1; fi

log "🔧  Inserting / updating Application block in $apps_file"
yq -i '
  .appProjects as $proj
  | (index($proj[]?; .name == "'"$release"'")) as $idx
  | if $idx == "" then
      .appProjects += [{
        name: "'"$release"'",
        applications: [{
          name: "'"$release"'",
          repoURL: "'"$HELM_REPO_URL"'",
          path: "'"$chart_path"'",
          autoSync: true,
          valueFiles: true
        }]
      }]
    else
      .appProjects[$idx].applications[0] = {
        name: "'"$release"'",
        repoURL: "'"$HELM_REPO_URL"'",
        path: "'"$chart_path"'",
        autoSync: true,
        valueFiles: true
      }
    end
' "$apps_file"

log "🗎  Post-edit appProjects snippet:"
yq '.appProjects[] | select(.name=="'"$release"'")' "$apps_file"

###############################################################################
# 7) Git add / commit / push
###############################################################################
git add "$apps_file" "$values_file" "$chart_path"
log "🔍  git status — after add:"
git status --short

if git diff --cached --quiet; then
  log "ℹ️  Nothing to commit – exiting cleanly."
  exit 0
fi

git commit -m "feat(${release}): add / update ${var_chart} ${var_version}"
log "📤  Pushing…"
git push -u origin "$branch"

log "🎉  Done – application \e[1m${release}\e[0m ready!"
echo -e "\e[1;32m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\e[0m\n"
