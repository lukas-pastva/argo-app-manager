# Argo Helm Toggler 🚀

A **tiny Git‑based web UI** that lets you add / remove Helm charts in your GitOps
*app‑of‑apps* repo and trigger an Argo Workflow (or any webhook).  
One container = React + Express + Helm.

---

## ✨ Features

|  |  |
|--|--|
| 🔍 **ArtifactHub search** | type three letters, pick a chart & version (with release date) |
| ✍️ **YAML diff editor** | only your changes are stored; defaults stay in the chart |
| 🗂 **Tabs per cluster/env** | each `app‑of‑apps*.yaml` file becomes a tab |
| 🌑 **Dark / Light / Auto** | theme switch with local persistence |
| 📅 **Version dates** | see when each chart version was published |
| 🗑 **One‑click delete** | removes an Application via webhook |
| 🛠 **Pure Git & Helm** | UI needs **no** K8s credentials |

---

## 🚀 Quick start (stand‑alone Docker)

```bash
docker build -t argo-helm-toggler .

docker run -p 8080:8080   -e GIT_REPO_SSH=git@github.com:my-org/argo-apps.git   -e GIT_SSH_KEY="$(cat ~/.ssh/id_ed25519)"   -e WF_WEBHOOK_URL=https://argo.example.com/api/helm-deploy   # optional overrides ⤵
  -e APPS_GLOB="stage-*.yaml"    argo-helm-toggler
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
| `WF_UPGRADE_WEBHOOK_URL` | `${WF_WEBHOOK_URL}/upgrade` | Upgrade webhook |
| **`WF_DOWNLOAD_WEBHOOK_URL`** | — | Download-only webhook URL |
| `WF_TOKEN` | — | Bearer token added to webhooks |
| `PORT` | `8080` | Port UI listens on |
| `APPS_GLOB` | `app-of-apps*.y?(a)ml` | File-mask for repo scan |

### Helper script `handle-helm-deploy.sh`

| Variable | Default | Purpose |
|----------|---------|---------|
| `APPS_DIR` | `clusters` | Base folder for app‑of‑apps files |
| `VALUES_SUBDIR` | `values` | Overrides sub-folder |
| `PUSH_BRANCH` | `main` | Branch for Git push |

---

## 🛰 Webhook payloads

### Deploy (POST `WF_WEBHOOK_URL`)

```json
{
  "chart": "grafana",
  "repo":  "https://charts.bitnami.com/bitnami",
  "version": "7.3.2",
  "owner": "bitnami",
  "name": "grafana",     // application / release name
  "release": "grafana",  // legacy field, same as name
  "namespace": "monitoring",
  "userValuesYaml": "..."  // base64‑encoded delta YAML
}
```

### Delete (POST `WF_DELETE_WEBHOOK_URL`)

```json
{ "release": "grafana", "namespace": "monitoring" }
```

### Upgrade (POST `WF_UPGRADE_WEBHOOK_URL`)

```json
{
  "chart": "grafana",
  "repo":  "https://charts.bitnami.com/bitnami",
  "version": "8.2.1",
  "owner": "bitnami",
  "release": "grafana",
  "namespace": "monitoring",
  "userValuesYaml": "..."  
}
```

### Download-only (POST `WF_DOWNLOAD_WEBHOOK_URL`)

```json
{
  "chart": "grafana",
  "repo":  "https://charts.bitnami.com/bitnami",
  "version": "7.3.2",
  "owner": "bitnami",
  "release": "grafana"
}
```

---

© 2025 Argo Helm Toggler • MIT
