# Argo Helm Toggler 🚀

Argo Helm Toggler is a **tiny Git‑based web UI** that lets you add / remove Helm charts from an *app‑of‑apps* repository and immediately trigger an Argo Workflows pipeline to deploy the change.

![UI screenshot](docs/screenshot.png)

---

## Features

|                                   | |
|-----------------------------------|--------------------------------------------------------------|
| 🔍 **ArtifactHub search**         | Type three letters, pick a chart & version                   |
| ✍️ **YAML diff editor**           | Only your changes are stored; defaults stay in the chart     |
| 🗂 **Tabs per cluster**           | Each `app-of-apps*.yaml` file gets its own tab               |
| 🌑 **Dark / Light / Auto**        | One‑click theme switch with local persistence                |
| 🗑 **One‑click delete**           | Removes an Application (after confirmation) via webhook      |
| 🛠 **Pure Git & Helm**            | No Kubernetes credentials needed for the UI                  |

---

## Quick Start (stand‑alone Docker)

```bash
docker build -t argo-helm-toggler .
docker run -p 8080:8080   -e GIT_REPO_SSH=git@github.com:my-org/argo-apps.git   -e GIT_SSH_KEY="$(cat ~/.ssh/id_ed25519)"   -e WF_WEBHOOK_URL=https://argo.example.com/api/helm-deploy   argo-helm-toggler
```

Open <http://localhost:8080>

> **Note** – you only need *read‑only* access to the repo inside the UI
> container because all writes happen via the workflow script.

---

## Environment Variables

| Variable | Required | Example | Purpose |
|----------|----------|---------|---------|
| **`GIT_REPO_SSH`** | ✅ | `git@github.com:org/argo-apps.git` | GitOps repo to clone |
| `GIT_BRANCH` |  | `main` | Branch to clone / auto‑pull |
| **`GIT_SSH_KEY`** or `GIT_SSH_KEY_B64` | ✅ | *(PEM or base64)* | Private key for the clone |
| **`WF_WEBHOOK_URL`** | ✅ | `https://argo/api/helm-deploy` | Deploy webhook |
| `WF_DELETE_WEBHOOK_URL` |  | – | Delete webhook (defaults to `/delete`) |
| `WF_TOKEN` |  | `bearer‑abc123` | Optional bearer token for both webhooks |
| `PORT` |  | `8080` | Port UI listens on |

---

## Webhook Payloads

Deploy (POST `WF_WEBHOOK_URL`)
```json
{
  "chart": "grafana",
  "repo": "https://charts.bitnami.com/bitnami",
  "version": "7.3.2",
  "release": "grafana",
  "namespace": "monitoring",
  "values_yaml": "...yaml delta..."
}
```

Delete (POST `WF_DELETE_WEBHOOK_URL`)
```json
{
  "release": "grafana",
  "namespace": "monitoring"
}
```

---

## `handle-helm-deploy.sh`

For CI / Argo Workflows a helper script lives in `scripts/handle-helm-deploy.sh`:

* Updates / creates the matching `app-of-apps` YAML
* Saves values file under `values/<release>.yaml`
* `helm pull` → `charts/external/<owner>/<chart>/<ver>/`
* Commits & pushes to `main`, a custom branch, **or a fresh PR branch**  
  (controlled by `PUSH_BRANCH=main|<name>|new`)

```bash
curl -s "$WF_WEBHOOK_URL" | PUSH_BRANCH=new ./handle-helm-deploy.sh
```

See the header comments inside the script for full behaviour.

---

## Dev mode

```bash
# Front‑end hot reload
cd frontend && npm run dev
# Back‑end hot reload
cd backend && nodemon src/index.js
```

---

## Roadmap

- [ ] Validation against chart `values.schema.json`
- [ ] Per‑user RBAC (GitHub SSO)
- [ ] Inline pod / service links once deployed

---

© 2025 Argo Helm Toggler • MIT‑licensed

```
argo-helm-toggler/
├── .dockerignore
├── Dockerfile
├── README.md
├── backend/
│   ├── package.json
│   └── src/
│       ├── argo.js
│       ├── config.js
│       ├── diff.js
│       ├── git.js
│       └── index.js
└── frontend/
    ├── index.html
    ├── package.json
    ├── vite.config.js
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── App.css
        └── components/
            ├── Tabs.jsx
            ├── ThemeToggle.jsx
            ├── AppsList.jsx
            ├── ChartSearch.jsx
            └── ValuesEditor.jsx
```