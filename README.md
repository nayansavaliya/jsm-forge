# JSM Forge Enterprise Service Desk

> **Config-as-Code** Forge application for JSM. All department, form, queue, and API source configuration lives in versioned YAML files in this repository. The Forge app is a pure runtime engine.

---

## 📁 Project Structure

```
jsm-forge/
├── config/                       ← ALL CONFIG LIVES HERE
│   ├── global.yaml               ← Company-wide portal settings
│   ├── api-sources/              ← External API credentials & endpoints
│   └── departments/
│       └── <dept>/
│           ├── department.yaml
│           ├── request-types/
│           └── queues/
├── src/
│   ├── config-loader/            ← YAML → Zod → TypeScript
│   ├── services/                 ← Token cache, external API proxy
│   ├── resolvers/                ← Forge Custom UI bridge
│   ├── engine/                   ← JSM sync engine
│   └── triggers/                 ← Issue event handlers
├── scripts/
│   ├── validate-config.ts        ← Run in CI
│   └── sync-dry-run.ts           ← Preview JSM changes
└── .github/workflows/
    ├── validate.yml              ← Runs on every PR
    └── deploy.yml                ← Runs on merge to main
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- Atlassian account with Forge access
- `forge login` completed

### Setup

```bash
npm install
forge login
```

### Validate config (no Atlassian connection needed)

```bash
npm run validate-config
```

### Preview sync changes

```bash
npm run sync-dry-run
```

### Deploy

```bash
forge deploy --environment production
forge install --upgrade --environment production
```

---

## 🔧 Adding a New Department

1. Create `config/departments/<dept-id>/department.yaml`
2. Add request types in `config/departments/<dept-id>/request-types/*.yaml`
3. Add queues in `config/departments/<dept-id>/queues/*.yaml`
4. Run `npm run validate-config` locally
5. Open a PR — CI will validate and show a sync dry-run preview
6. Merge → CI auto-deploys

---

## 🔑 Managing API Credentials

API source credentials are stored in **Forge Secrets** — never in YAML files.

```bash
# Set a secret (one-time per environment)
forge variables:set --environment production --encrypt INV_API_USER "service-account@acme.com"
forge variables:set --environment production --encrypt INV_API_PASS "super-secret-password"
```

Reference the secret name (not value) in your `config/api-sources/*.yaml`:

```yaml
authType: login-bearer
auth:
  usernameSecretKey: INV_API_USER   # ← Forge Secret name
  passwordSecretKey: INV_API_PASS   # ← Forge Secret name
```

---

## 🧩 Supported Auth Types

| `authType` | Description |
|---|---|
| `login-bearer` | POST username+password to a login endpoint → receive bearer token |
| `api-key` | Static key injected into a header or query param |
| `oauth2-client-credentials` | Standard OAuth2 M2M client credentials flow |

---

## 📋 Config File Reference

See [`docs/`](./docs/) for full schema reference and examples.

---

## 🔒 Security

- API credentials live **only** in Forge Secrets
- External API proxy enforces per-source `allowedPaths` whitelist
- All config changes go through PR review (branch protection recommended)
- PII fields (`pii: true`) are excluded from logs and cache
