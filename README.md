# Argo Helm Toggler 🚀

A **tiny Git‑based web UI** that lets you add / remove Helm charts in your GitOps
*app‑of‑apps* repo and trigger an Argo Workflow (or any webhook).  
One container = React + Express + Helm.

---

## ✨ Features

|  |  |
|--|--|
| 🔍 **ArtifactHub search** | type three letters, pick a chart & version |
| ✍️ **YAML diff editor** | only your changes are stored; defaults stay in the chart |
| 🗂 **Tabs per cluster/env** | each `app‑of‑apps*.yaml` file becomes a tab |
| 🌑 **Dark / Light / Auto** | theme switch with local persistence |
| 🗑 **One‑click delete** | removes an Application via webhook |
| 🛠 **Pure Git & Helm** | UI needs **no** K8s credentials |

![UI screenshot](docs/screenshot.png)

---

## 🚀 Quick start (stand‑alone Docker)

```bash
docker build -t argo-helm-toggler .

docker run -p 8080:8080 \
  -e GIT_REPO_SSH=git@github.com:my-org/argo-apps.git \
  -e GIT_SSH_KEY="$(cat ~/.ssh/id_ed25519)" \
  -e WF_WEBHOOK_URL=https://argo.example.com/api/helm-deploy \
  # optional overrides ⤵
  -e APPS_GLOB="stage-*.yaml"  \
  argo-helm-toggler
```

Open <http://localhost:8080>

> Only a *read‑only* clone is kept inside the UI container – all **writes**
> happen in the CI job that runs `handle-helm-deploy.sh`.

---

## 🌡 Environment variables

### Backend container

| Variable | Default | Purpose |
|----------|---------|---------|
| **`GIT_REPO_SSH`** | — | GitOps repo to clone (read‑only) |
| `GIT_BRANCH` | `main` | Branch to pull |
| **`GIT_SSH_KEY`** or `GIT_SSH_KEY_B64` | — | Private key (plain or base64) |
| **`WF_WEBHOOK_URL`** | — | Deploy webhook URL |
| `WF_DELETE_WEBHOOK_URL` | `${WF_WEBHOOK_URL}/delete` | Delete webhook |
| `WF_TOKEN` | — | Bearer token added to both webhooks |
| `PORT` | `8080` | Port UI listens on |
| `APPS_GLOB` | `app-of-apps*.y?(a)ml` | Glob the backend scans for (tabs) |

### Helper script `handle-helm-deploy.sh`

| Variable | Default | Purpose |
|----------|---------|---------|
| `APPS_DIR` | `clusters` | Base folder that contains app‑of‑apps files |
| `APP_FILE_GLOB` | value of `APPS_GLOB` | File‑mask when locating/creating the YAML |
| `VALUES_SUBDIR` | `values` | Sub‑folder (next to YAML) for `<release>.yaml` overrides |
| `PUSH_BRANCH` | `main` | `main`, a fixed name, or `new` (creates `helm-<rel>-<stamp>`) |

---

## 🛰 Webhook payloads

Deploy (POST `WF_WEBHOOK_URL`)

```json
{
  "chart": "grafana",
  "repo":  "https://charts.bitnami.com/bitnami",
  "version": "7.3.2",
  "release": "grafana",
  "namespace": "monitoring",
  "values_yaml": "...yaml delta..."
}
```

Delete (POST `WF_DELETE_WEBHOOK_URL`)

```json
{ "release": "grafana", "namespace": "monitoring" }
```

---

## `scripts/handle-helm-deploy.sh`

* Updates/creates the *app‑of‑apps* YAML (glob + dir overridable)
* Saves values file under `$APPS_DIR/$VALUES_SUBDIR/<release>.yaml`
* `helm pull` → `charts/external/<owner>/<chart>/<version>/`
* Commits & pushes to `PUSH_BRANCH`

Typical usage in CI:

```bash
curl -s "${WF_WEBHOOK_URL}" \
  | APPS_DIR=clusters/prod VALUES_SUBDIR=helm-values \
    APP_FILE_GLOB="prod-apps.yaml" PUSH_BRANCH=new \
    ./scripts/handle-helm-deploy.sh
```

---

## Dev mode

```bash
# Front‑end hot‑reload
cd src/frontend && npm run dev
# Back‑end hot‑reload (requires nodemon)
cd src/backend  && nodemon src/index.js
```

---

© 2025 Argo Helm Toggler • MIT
