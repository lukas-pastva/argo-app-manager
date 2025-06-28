#!/usr/bin/env bash
#───────────────────────────────────────────────────────────────────────────────
#  handle-helm-deploy.sh  (Argo-Workflow template-friendly)
#
#  • Writes Helm values under ./values/<release>.yml
#  • Keeps / updates an “appProjects”–style app-of-apps YAML
#  • Pulls the chart into   external/<chart>/<chart>/<version>/
#  • Commits & pushes to the GitOps repo
#
#  Required tools:  git  jq  yq(v4)  helm
#───────────────────────────────────────────────────────────────────────────────
set -Eeuo pipefail
[[ ${DEBUG:-false} == "true" ]] && set -x

# ─── tiny log helper ──────────────────────────────────────────────────────────
log() { printf '\e[1;34m[%(%F %T)T]\e[0m %s\n' -1 "$*" >&2; }
trap 'log "❌  Failed at line $LINENO – »${BASH_COMMAND}«"' ERR

# ══════════════════════════════════════════════════════════════════════════════
#  0)  Inputs from the Argo-Workflow template
#      (Argo substitutes the {{…}} placeholders at runtime)
# ══════════════════════════════════════════════════════════════════════════════
var_name="{{inputs.parameters.var_name}}"
var_chart="{{inputs.parameters.var_chart}}"
var_version="{{inputs.parameters.var_version}}"
var_namespace="{{inputs.parameters.var_namespace}}"
var_userValuesYaml="{{inputs.parameters.var_userValuesYaml}}"

for p in var_name var_chart var_version var_namespace var_userValuesYaml; do
  [[ "${!p}" =~ \{\{.*\}\} ]] && { log "missing parameter $p"; exit 1; }
done

release="${var_name:-$var_chart}"
values_yaml="${var_userValuesYaml}"

log "🚀  Request: ${release} → ${var_namespace} • ${var_chart}@${var_version}"

# ══════════════════════════════════════════════════════════════════════════════
#  1)  Required env-vars (fail fast if any is missing)
# ══════════════════════════════════════════════════════════════════════════════
: "${GIT_SSH_KEY:?need GIT_SSH_KEY}"
: "${GITOPS_REPO:?need GITOPS_REPO}"
: "${GIT_EMAIL:?need GIT_EMAIL}"
: "${GIT_USER:?need GIT_USER}"

# ══════════════════════════════════════════════════════════════════════════════
#  2)  Repo-local parameters (all overridable through env-vars)
# ══════════════════════════════════════════════════════════════════════════════
APPS_DIR="${APPS_DIR:-.}"                      # repo-relative folder (default root)
APP_FILE_NAME="${APP_FILE_NAME:-app-of-apps.yaml}"
VALUES_SUBDIR="${VALUES_SUBDIR:-values}"
CHARTS_ROOT="external"                         # where pulled charts end up
PUSH_BRANCH="${PUSH_BRANCH:-main}"             # main | <fixed> | new
HELM_REPO_URL="${HELM_REPO_URL:-git@gitlab.com:tronic-sk/helm-charts.git}"

# ══════════════════════════════════════════════════════════════════════════════
#  3)  Clone GitOps repo using the provided private key
# ══════════════════════════════════════════════════════════════════════════════
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

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
log "🔀  Working on branch $branch"

# ══════════════════════════════════════════════════════════════════════════════
#  4)  Paths & files
# ══════════════════════════════════════════════════════════════════════════════
apps_file="$APPS_DIR/$APP_FILE_NAME"
[[ -f $apps_file ]] || { mkdir -p "$(dirname "$apps_file")"; echo "appProjects: []" > "$apps_file"; }

values_dir="$(dirname "$apps_file")/$VALUES_SUBDIR"
values_file="$values_dir/${release}.yml"
mkdir -p "$values_dir"
printf '%s\n' "$values_yaml" > "$values_file"
log "📝  Values → $values_file"

# chart gets copied to:  external/<chart>/<chart>/<version>/
chart_path="${CHARTS_ROOT}/${var_chart}/${var_chart}/${var_version}"

# ══════════════════════════════════════════════════════════════════════════════
#  5)  Pull / cache Helm chart inside the repo (idempotent)
# ══════════════════════════════════════════════════════════════════════════════
if [[ -d $chart_path ]]; then
  log "📦  Chart already present – skipping download"
else
  log "⬇️   Pulling chart to ${chart_path}"
  tmpchart="$(mktemp -d)"
  helm pull "${HELM_REPO_URL}/${var_chart}" --version "$var_version" -d "$tmpchart" >/dev/null
  tar -xzf "$tmpchart/${var_chart}-${var_version}.tgz" -C "$tmpchart"
  mkdir -p "$chart_path"
  mv "$tmpchart/${var_chart}/"* "$chart_path/"
  rm -rf "$tmpchart"
fi

# ══════════════════════════════════════════════════════════════════════════════
#  6)  Upsert the entry inside appProjects[…].applications[…]
# ══════════════════════════════════════════════════════════════════════════════
if ! command -v yq >/dev/null; then
  log "❌  yq v4 is required for YAML edits"; exit 1
fi

yq -i '
  .appProjects as $proj
  | (index($proj[]?; .name == "'"$release"'")) as $idx
  | if $idx == "" then
      # ─── append new project ───────────────────────────────────────────────
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
      # ─── update existing project/app ──────────────────────────────────────
      .appProjects[$idx].applications[0] = {
        name: "'"$release"'",
        repoURL: "'"$HELM_REPO_URL"'",
        path: "'"$chart_path"'",
        autoSync: true,
        valueFiles: true
      }
    end
' "$apps_file"

# ══════════════════════════════════════════════════════════════════════════════
#  7)  Commit & push
# ══════════════════════════════════════════════════════════════════════════════
git add "$apps_file" "$values_file" "$chart_path"

if git diff --cached --quiet; then
  log "ℹ️  No changes – nothing to push."
  exit 0
fi

git commit -m "feat(${release}): add / update ${var_chart} ${var_version}"
log "📤  Pushing to origin/$branch"
git push -u origin "$branch"

log "✅  Completed for ${release}"
