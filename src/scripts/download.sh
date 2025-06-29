#!/usr/bin/env bash
#───────────────────────────────────────────────────────────────────────────────
#  download.sh  –  v1.1
#  *For “Download Helm chart only” requests from Helm-Toggler*
#───────────────────────────────────────────────────────────────────────────────
set -Eeuo pipefail
[[ ${DEBUG:-false} == "true" ]] && set -x

log() { printf '\e[1;34m[%(%F %T)T]\e[0m %b\n' -1 "$*" >&2; }
trap 'log "❌  FAILED (line $LINENO) 👉 «$BASH_COMMAND»"; exit 1' ERR
echo -e "\n\e[1;33m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\e[0m"

###############################################################################
# 0) Workflow inputs  (Argo substitutes these before execution)
###############################################################################
var_chart="{{inputs.parameters.var_chart}}"
var_version="{{inputs.parameters.var_version}}"
var_repo="{{inputs.parameters.var_repo}}"
var_owner="{{inputs.parameters.var_owner}}"

for p in var_chart var_version var_repo; do
  [[ ${!p} =~ \{\{.*\}\} ]] && { log "🚫  $p not substituted – abort"; exit 1; }
done

log "📦  Download request:"
log "    • chart     = ${var_chart}"
log "    • version   = ${var_version}"
log "    • helm repo = ${var_repo}"
log "    • owner     = ${var_owner}"

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
# 2) Paths / settings
###############################################################################
PUSH_BRANCH="${PUSH_BRANCH:-main}"

chart_path="charts/external/${var_owner}/${var_chart}/${var_version}"
log "📁  chart_path  = ${chart_path}"

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
  branch="helm-download-${var_chart}-${var_version}-$(date +%Y%m%d%H%M%S)"
  git checkout -b "$branch"
else
  git checkout "$PUSH_BRANCH"
  branch="$PUSH_BRANCH"
fi
log "🌿  Using branch \e[1m$branch\e[0m"

###############################################################################
# 4) Download chart (if not cached)
###############################################################################
if [[ -d $chart_path ]]; then
  log "✅  Chart already present → $chart_path  (nothing to do)"
  exit 0
fi

log "⬇️   helm pull → $chart_path"
tempc="$(mktemp -d)"
helm pull "${var_chart}" --repo "${var_repo}" --version "${var_version}" -d "$tempc" > /dev/null
tar -xzf "$tempc/${var_chart}-${var_version}.tgz" -C "$tempc"

mkdir -p "$chart_path"
mv "$tempc/${var_chart}/"* "$chart_path/"
rm -rf "$tempc"
log "🗃  Chart extracted"

###############################################################################
# 5) Commit & push
###############################################################################
git add "$chart_path"
git status --short

git commit -m "chore: cache ${var_chart} ${var_version}"
log "📤  Pushing…"
git push -u origin "$branch"

log "🎉  Done – chart cached at \e[1m${chart_path}\e[0m!"
echo -e "\e[1;32m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\e[0m\n"
