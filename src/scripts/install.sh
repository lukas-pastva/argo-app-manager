#!/usr/bin/env bash
#───────────────────────────────────────────────────────────────────────────────
#  install.sh   –   v3.0  (namespace-only + dual app styles)
#───────────────────────────────────────────────────────────────────────────────
set -Eeuo pipefail
[[ ${DEBUG:-false} == "true" ]] && set -x

log() { printf '\e[1;34m[%(%F %T)T]\e[0m %b\n' -1 "$*" >&2; }
trap 'log "❌  FAILED (line $LINENO) 👉 «$BASH_COMMAND»"; exit 1' ERR
echo -e "\n\e[1;33m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\e[0m"

###############################################################################
# 0) Workflow inputs  (Argo substitutes these before execution)
###############################################################################
# — always present —
var_release="{{inputs.parameters.var_release}}"
var_chart="{{inputs.parameters.var_chart}}"
var_version="{{inputs.parameters.var_version}}"
var_namespace="{{inputs.parameters.var_namespace}}"
var_repo="{{inputs.parameters.var_repo}}"
var_userValuesYaml="{{inputs.parameters.var_userValuesYaml}}"

# — external charts only —
var_name="{{inputs.parameters.var_name}}"
var_owner="{{inputs.parameters.var_owner}}"

# — internal “trio” style —
var_applicationCode="{{inputs.parameters.var_applicationCode}}"
var_team="{{inputs.parameters.var_team}}"
var_env="{{inputs.parameters.var_env}}"

# helper – blank-out any value that was NOT substituted by Argo
unset_if_unsubstituted() {
  local v="$1"; [[ $v =~ \{\{.*\}\} ]] && echo "" || echo "$v"
}
var_name=$(unset_if_unsubstituted "$var_name")
var_owner=$(unset_if_unsubstituted "$var_owner")
var_applicationCode=$(unset_if_unsubstituted "$var_applicationCode")
var_team=$(unset_if_unsubstituted "$var_team")
var_env=$(unset_if_unsubstituted "$var_env")

# decide which style we’re in ✨
if [[ -n $var_applicationCode ]]; then
  STYLE="trio"          # applicationCode / team / env
else
  STYLE="name"          # classic “name” style (default)
fi

# sanity checks ---------------------------------------------------------------
for p in var_chart var_version var_namespace var_repo var_userValuesYaml; do
  [[ -z ${!p} ]] && { log "🚫  $p is empty – abort"; exit 1; }
done
if [[ $STYLE == "name" && -z $var_name ]]; then
  log "🚫  STYLE=name but var_name is empty – abort"
  exit 1
fi

log "🗒  Detected style: $STYLE"
if [[ $STYLE == "name" ]]; then
  log "    • name        = $var_name"
  log "    • owner       = $var_owner"
else
  log "    • team        = $var_team"
  log "    • env         = $var_env"
  log "    • appCode     = $var_applicationCode"
fi
log "    • namespace   = $var_namespace"
log "    • chart       = $var_chart@$var_version"

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

if [[ $STYLE == "name" ]]; then
  chart_path="charts/external/${var_owner}/${var_chart}/${var_version}"
else
  chart_path="internal/charts/${var_team}/${var_applicationCode}/${var_version}"
fi

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
# 5) Download / cache Helm chart
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

export VAR_NAMESPACE="$var_namespace"
export CHART_PATH="$chart_path"
export GITOPS_REPO
export VAR_NAME="$var_name"
export VAR_APP_CODE="$var_applicationCode"
export VAR_TEAM="$var_team"
export VAR_ENV="$var_env"

if [[ $STYLE == "name" ]]; then
  yq_filter='.appProjects = (.appProjects // []) |
    (.appProjects) |= map(select(.namespace != env(VAR_NAME))) |
    .appProjects += [{
      "namespace": env(VAR_NAME),
      "applications": [{
        "name"      : env(VAR_NAME),
        "repoURL"   : env(GITOPS_REPO),
        "path"      : env(CHART_PATH),
        "autoSync"  : true,
        "valueFiles": true
      }]
    }]'
else
  yq_filter='.appProjects = (.appProjects // []) |
    (.appProjects) |= map(select(.namespace != env(VAR_NAMESPACE))) |
    .appProjects += [{
      "namespace": env(VAR_NAMESPACE),
      "applications": [{
        "applicationCode": env(VAR_APP_CODE),
        "team"           : env(VAR_TEAM),
        "env"            : env(VAR_ENV),
        "path"           : env(CHART_PATH),
        "rbac"           : {}
      }]
    }]'
fi

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

if [[ $STYLE == "name" ]]; then
  commit_id="$var_name"
else
  commit_id="$var_applicationCode"
fi
git commit -m "feat(${commit_id}): add/update ${var_chart} ${var_version}"
log "📤  Pushing…"
git push -u origin "$branch"

log "🎉  Done – Application \e[1m${commit_id}\e[0m committed!"
echo -e "\e[1;32m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\e[0m\n"
