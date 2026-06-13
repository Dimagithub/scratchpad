# Deployment & Auto-Updater Design

**Date:** 2026-06-13  
**Status:** Approved

## Overview

Set up a GitHub Pages download site and wire up Tauri's auto-updater with proper signing. The download page lives in `site/` in the main repo; a GitHub Actions workflow deploys it to `gh-pages` on every push. Installer files are hosted on GitHub Releases; `site/latest.json` is the updater manifest.

---

## Components

### 1. `site/` folder (in repo root)

Two files:

**`site/index.html`** — Simple download landing page:
- App name "ScratchPad" + tagline ("A lightweight tabbed notepad for Windows")
- Windows download button linking to the GitHub Release `.exe` asset
- Note about macOS (coming soon / link to existing DMG)
- Minimal styling, no external dependencies (single self-contained HTML file)

**`site/latest.json`** — Tauri updater manifest, updated manually per release:
```json
{
  "version": "0.1.0",
  "notes": "Initial Windows release",
  "pub_date": "2026-06-13T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<contents of .sig file>",
      "url": "https://github.com/Dimagithub/scratchpad/releases/download/v0.1.0/ScratchPad_0.1.0_x64-setup.exe"
    }
  }
}
```

### 2. GitHub Actions workflow

**`.github/workflows/deploy-site.yml`** — deploys `site/` to `gh-pages` branch on push to `main`:

```yaml
name: Deploy site
on:
  push:
    branches: [main]
    paths:
      - 'site/**'
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./site
```

Deploys only when files under `site/` change.

### 3. Tauri updater signing

**One-time key generation** (run locally, never commit output):
```bash
npx tauri signer generate -w $HOME/.tauri/scratchpad.key
```
Output: a `.key` file (private key + password printed to terminal) and a public key string.

**`src-tauri/tauri.conf.json` changes:**
- `plugins.updater.pubkey` → set to the generated public key string
- `plugins.updater.endpoints[0]` → `"https://dimagithub.github.io/scratchpad/latest.json"`

**Building a signed release** (set env vars before building):
```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "<base64 private key from .key file>"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<password>"
npm run tauri:build
```
Produces `.sig` files alongside each installer (e.g. `ScratchPad_0.1.0_x64-setup.exe.sig`).

---

## Release workflow (post-setup, manual)

1. Bump `"version"` in `src-tauri/tauri.conf.json` and `package.json`
2. Set signing env vars, run `npm run tauri:build`
3. Create GitHub Release tagged `v<version>`, upload `ScratchPad_<version>_x64-setup.exe`
4. Open `src-tauri/target/release/bundle/nsis/ScratchPad_<version>_x64-setup.exe.sig`, copy its contents
5. Update `site/latest.json`: bump `version`, `pub_date`, paste signature, update download URL
6. Update `site/index.html` download link to new release URL
7. `git add site/ && git commit && git push` → Actions deploys automatically

---

## GitHub Pages configuration

In GitHub repo Settings → Pages:
- Source: Deploy from branch
- Branch: `gh-pages`, folder: `/ (root)`

This must be configured once after the first Actions deployment.

---

## URLs

| Resource | URL |
|---|---|
| Download page | `https://dimagithub.github.io/scratchpad/` |
| Updater endpoint | `https://dimagithub.github.io/scratchpad/latest.json` |
| Windows installer (v0.1.0) | `https://github.com/Dimagithub/scratchpad/releases/download/v0.1.0/ScratchPad_0.1.0_x64-setup.exe` |

---

## Out of scope

- Automated release builds (CI signing)
- macOS updater signing
- Analytics or download counting
- Custom domain
