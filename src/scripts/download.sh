#!/usr/bin/env bash
#───────────────────────────────────────────────────────────────────────────────
#  download.sh  –  v1.2
#  *For “Download Helm chart only” requests from App-Manager*
#  Changes:
#    - Use `helm pull --untar` to avoid filename assumptions
#    - Auto-retry with `v${version}` (Jetstack charts are v-prefixed)
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

pull_and_untar() {
  local ver="$1"
  # --untar extracts into --untardir/<chartName>
  helm pull "${var_chart}" \
    --repo "${var_repo}" \
    --version "${ver}" \
    --untar \
    --untardir "${tempc}" > /dev/null
}

# try exact version first; if it fails (or repo expects v-prefix), retry
set +e
pull_and_untar "${var_version}"
rc=$?
if (( rc != 0 )) && [[ ${var_version} != v* ]]; then
  log "ℹ️  Retrying with version v${var_version} (some repos, incl. Jetstack, publish v-prefixed chart versions)…"
  pull_and_untar "v${var_version}"
  rc=$?
fi
set -e

if (( rc != 0 )); then
  log "🚫  helm pull failed for versions: '${var_version}' and 'v${var_version}'."
  exit 1
fi

# sanity check
[[ -d "${tempc}/${var_chart}" ]] || { log "🚫  Expected dir '${tempc}/${var_chart}' not found after pull."; exit 1; }

mkdir -p "$chart_path"
# copy content (not the top-level dir) to the cache path
cp -a "${tempc}/${var_chart}/." "$chart_path/"
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
