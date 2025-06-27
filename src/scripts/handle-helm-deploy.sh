#!/usr/bin/env bash
#───────────────────────────────────────────────────────────────────────────────
#  handle-helm-deploy.sh
#  Process JSON from Helm-Toggler, update GitOps repo and push the change.
#
#  Requirements:  jq  yq(v4)  helm  git
#───────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ════════════════ CONFIGURE ═══════════════════════════════════════════════════
APPS_DIR="clusters"                          # 📂 where app-of-apps YAML lives
VALUES_SUBDIR="values"                       # 📂 written next to that YAML
CHARTS_ROOT="charts/external"                # 📂 extracted chart storage root
APP_FILE_PATTERN="app-of-apps*.y?(a)ml"      # glob to pick the file

PUSH_BRANCH="${PUSH_BRANCH:-main}"           # main | <branch> | new
COMMIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-helm-toggler}"
COMMIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-helm-toggler@local}"

# ════════════════ READ PAYLOAD ════════════════════════════════════════════════
json="$(cat)"
j() { echo "$json" | jq -r "$1"; }

chart=$(j .chart)
repo=$(j .repo)
version=$(j .version)
release=$(j .release)
namespace=$(j .namespace)
values=$(j .values_yaml)

[[ -z $chart || -z $repo || -z $release || -z $namespace ]] && {
  echo "❌  Missing required fields in webhook" >&2; exit 1; }

echo "🚀  Deploy request: $release → $namespace  •  $chart@$version"

# ════════════════ 1) locate / create app-of-apps file ════════════════════════
apps_file=$(find "$APPS_DIR" -type f -name "$APP_FILE_PATTERN" | head -n1)
if [[ -z $apps_file ]]; then
  echo "🆕  Creating new app-of-apps file in $APPS_DIR/"
  apps_file="$APPS_DIR/app-of-apps.yaml"
  mkdir -p "$(dirname "$apps_file")" && touch "$apps_file"
else
  echo "📄  Using app-of-apps file: $apps_file"
fi

values_dir="$(dirname "$apps_file")/$VALUES_SUBDIR"
values_file="$values_dir/${release}.yaml"
mkdir -p "$values_dir"
echo "$values" > "$values_file"
echo "📝  Wrote values → $values_file"

# ════════════════ 2) build Application YAML ══════════════════════════════════
app_yaml=$(cat <<EOF
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: ${release}
spec:
  project: default
  destination:
    server: https://kubernetes.default.svc
    namespace: ${namespace}
  source:
    repoURL: ${repo}
    chart: ${chart}
    targetRevision: ${version}
    helm:
      valueFiles:
        - ${VALUES_SUBDIR}/${release}.yaml
EOF
)

# ════════════════ 3) insert / update in YAML ═════════════════════════════════
if yq 'select(.kind=="Application") | .metadata.name' "$apps_file" \
     | grep -qx "$release"
then
  echo "🔄  Updating existing Application in app-of-apps file"
  yq -i '
    (.[] | select(.kind=="Application" and .metadata.name=="'$release'")
    ).spec = load("'"$app_yaml"'" ) .spec
  ' "$apps_file"
else
  echo "➕  Appending new Application to file"
  printf '%s\n---\n' "$app_yaml" >> "$apps_file"
fi

# ════════════════ 4) download chart ══════════════════════════════════════════
owner=$(echo "$repo" | sed -E 's#.+/([^/]+)/?$#\1#')
target_dir="${CHARTS_ROOT}/${owner}/${chart}/${version}"

if [[ -d $target_dir ]]; then
  echo "📦  Chart already present → $target_dir"
else
  echo "⬇️   Pulling chart into $target_dir"
  tmp=$(mktemp -d)
  helm pull "$repo/$chart" --version "$version" -d "$tmp" >/dev/null
  tar xzf "$tmp/${chart}-${version}.tgz" -C "$tmp"
  mkdir -p "$target_dir"
  mv "$tmp/$chart"/* "$target_dir/"
  rm -rf "$tmp"
  echo "✅  Chart extracted"
fi

# ════════════════ 5) git add / commit / push ═════════════════════════════════
git add "$apps_file" "$values_file" "$target_dir"

if git diff --cached --quiet; then
  echo "💡  No git changes detected — nothing to push."
  exit 0
fi

git config user.email "$COMMIT_AUTHOR_EMAIL"
git config user.name  "$COMMIT_AUTHOR_NAME"

if [[ $PUSH_BRANCH == "new" ]]; then
  new_branch="helm-${release}-$(date +%Y%m%d%H%M%S)"
  git checkout -b "$new_branch"
  branch_to_push="$new_branch"
  echo "🌱  Created new branch $branch_to_push"
else
  git checkout "$PUSH_BRANCH"
  branch_to_push="$PUSH_BRANCH"
  echo "🌿  Using branch $branch_to_push"
fi

git commit -m "feat: add/update ${release} (${namespace}) chart ${chart} ${version}"
echo "📤  Pushing to origin/$branch_to_push"
git push -u origin "$branch_to_push"

echo "🎉  All done!"
