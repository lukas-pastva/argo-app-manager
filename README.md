# Argo App Manager

A web UI for managing Helm charts in a GitOps app-of-apps repository.
Reads from GitLab via API, triggers deployments via webhooks (Argo Workflows or any HTTP endpoint).
Single container: React frontend + Express backend.

---

## Features

- **ArtifactHub search** -- type three letters, pick a chart and version (with release dates)
- **YAML diff editor** -- only your overrides are stored; chart defaults stay untouched
- **Tabs per cluster/env** -- each `app-of-apps*.yaml` file becomes a sidebar tab
- **Dark / Light / Auto theme** -- segmented toggle, persisted in localStorage
- **Installed charts view** -- shows existing charts from the repo grouped by publisher
- **Download-only mode** -- optional mode that only pulls charts without creating Applications
- **Custom branding** -- configurable title and description via environment variables
- **One-click delete** -- removes an Application via webhook
- **No K8s credentials needed** -- the UI only talks to GitLab API and webhooks

---

## Quick start

```bash
docker build -t argo-app-manager ./src

docker run -p 8080:8080 \
  -e GITLAB_URL=https://gitlab.example.com \
  -e GITLAB_PROJECT_ID=42 \
  -e GITLAB_TOKEN=glpat-xxxxxxxxxxxx \
  -e WF_WEBHOOK_URL=https://argo.example.com/api/helm-deploy \
  argo-app-manager
```

Open <http://localhost:8080>

---

## Environment variables

### Required

| Variable | Purpose |
|----------|---------|
| `GITLAB_URL` | GitLab instance URL (e.g. `https://gitlab.example.com`) |
| `GITLAB_PROJECT_ID` | Numeric GitLab project ID |
| `GITLAB_TOKEN` | GitLab personal/project access token (`read_api` scope) |

### Git

| Variable | Default | Purpose |
|----------|---------|---------|
| `GIT_BRANCH` | `main` | Branch to read from |
| `APPS_GLOB` | `app-of-apps*.y?(a)ml` | Glob pattern for app-of-apps YAML files |

### Webhooks

| Variable | Default | Purpose |
|----------|---------|---------|
| `WF_WEBHOOK_URL` | -- | Install webhook URL |
| `WF_DELETE_WEBHOOK_URL` | -- | Delete webhook URL |
| `WF_UPGRADE_WEBHOOK_URL` | -- | Upgrade webhook URL |
| `WF_DOWNLOAD_WEBHOOK_URL` | -- | Download-only webhook URL |
| `WF_TOKEN` | -- | Bearer token sent with webhook requests |

### UI customisation

| Variable | Default | Purpose |
|----------|---------|---------|
| `APP_TITLE` | `Argo App Manager` | Custom heading shown in the top bar |
| `APP_DESCRIPTION` | -- | Description text below the title |
| `DOWNLOAD_ONLY` | `false` | When `true`, only download mode is available (no install) |

### Installed charts

| Variable | Default | Purpose |
|----------|---------|---------|
| `HELM_CHARTS_PATH` | -- | Repo-relative path to installed charts (e.g. `external/charts`). When set, the main page shows existing charts grouped by publisher. Expected structure: `<path>/<publisher>/<chart>/<version>/` |

### Misc

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `8080` | Port the server listens on |

---

## Webhook payloads

### Install (POST `WF_WEBHOOK_URL`)

```json
{
  "chart": "grafana",
  "repo": "https://charts.bitnami.com/bitnami",
  "version": "7.3.2",
  "owner": "bitnami",
  "name": "grafana",
  "release": "grafana",
  "namespace": "monitoring",
  "userValuesYaml": "..."
}
```

### Delete (POST `WF_DELETE_WEBHOOK_URL`)

```json
{ "release": "grafana", "namespace": "monitoring" }
```

### Upgrade (POST `WF_UPGRADE_WEBHOOK_URL`)

```json
{
  "chart": "grafana",
  "repo": "https://charts.bitnami.com/bitnami",
  "version": "8.2.1",
  "owner": "bitnami",
  "release": "grafana",
  "namespace": "monitoring",
  "userValuesYaml": "..."
}
```

### Download (POST `WF_DOWNLOAD_WEBHOOK_URL`)

```json
{
  "chart": "grafana",
  "repo": "https://charts.bitnami.com/bitnami",
  "version": "7.3.2",
  "owner": "bitnami",
  "release": "grafana"
}
```

---

## Kubernetes deployment

The container runs as a non-root user and needs no writable filesystem. Example env snippet for a Kubernetes deployment:

```yaml
env:
  - name: GITLAB_URL
    value: "https://gitlab.example.com"
  - name: GITLAB_PROJECT_ID
    value: "42"
  - name: GITLAB_TOKEN
    valueFrom:
      secretKeyRef:
        name: secret
        key: YAML_GITLAB_TOKEN
  - name: GIT_BRANCH
    value: "main"
  - name: WF_WEBHOOK_URL
    value: "https://argo.example.com/api/helm-deploy"
  - name: HELM_CHARTS_PATH
    value: "external/charts"
```
