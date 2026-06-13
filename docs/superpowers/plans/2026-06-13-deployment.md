# Deployment & Auto-Updater Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up GitHub Pages download site, generate Tauri signing keys, do a signed build, and wire the auto-updater to the deployed `latest.json`.

**Architecture:** `site/` in the repo root holds `index.html` and `latest.json`; a GitHub Actions workflow deploys `site/` to the `gh-pages` branch on every push to main. Tauri's updater is pointed at `https://dimagithub.github.io/scratchpad/latest.json`. The NSIS installer is signed locally using a keypair generated once and stored outside the repo.

**Tech Stack:** Tauri 2 signer CLI, GitHub Pages, GitHub Actions (`peaceiris/actions-gh-pages`), PowerShell

---

## Files

- Create: `site/index.html` — download landing page
- Create: `site/latest.json` — Tauri updater manifest (populated after signed build)
- Create: `.github/workflows/deploy-site.yml` — deploys site/ to gh-pages
- Modify: `src-tauri/tauri.conf.json` — set pubkey + updater endpoint

---

### Task 1: Generate signing keypair

**Files:** none committed — key lives at `~/.tauri/scratchpad.key` (never commit this)

The signing key is generated once. The **public key** goes into `tauri.conf.json`; the **private key file** stays on disk outside the repo and is never committed.

- [ ] **Step 1: Generate the keypair with no password (simplest for local builds)**

```powershell
cd D:\Projects\scratchpad
npx tauri signer generate -w "$HOME\.tauri\scratchpad.key" --no-password --force 2>&1
```

Expected output (abbreviated):
```
Your keypair was generated successfully
Private: C:\Users\<you>\.tauri\scratchpad.key (Keep it secret!)
Public key: dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6XXXXXXXX
XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX==
```

- [ ] **Step 2: Capture the public key**

The public key is the two-line block starting with `dW50cnVzdGVkIG...`. Copy it — you need it in Task 2.

To print it again at any time:
```powershell
npx tauri signer generate -w "$HOME\.tauri\scratchpad.key" --no-password --force 2>&1 | Select-String -Pattern "^[dW|AAAAB|AAAA]" -Context 0,1
```

Or just run Step 1 again (the `--force` flag overwrites and re-prints).

---

### Task 2: Update tauri.conf.json

**Files:**
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Replace the updater section**

In `src-tauri/tauri.conf.json`, replace the entire `"plugins"` block with:

```json
  "plugins": {
    "updater": {
      "endpoints": [
        "https://dimagithub.github.io/scratchpad/latest.json"
      ],
      "pubkey": "<paste the full public key from Task 1 here>"
    }
  }
```

The public key is the full two-line string from Task 1 output, e.g.:
```
dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6XXXXXXXX\nXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX==
```

- [ ] **Step 2: Verify JSON is valid**

```powershell
Get-Content D:\Projects\scratchpad\src-tauri\tauri.conf.json | ConvertFrom-Json | Select-Object -ExpandProperty plugins
```

Expected: shows `updater` object with the new endpoint and a non-empty pubkey.

- [ ] **Step 3: Commit**

```bash
git -C D:\Projects\scratchpad add src-tauri/tauri.conf.json
git -C D:\Projects\scratchpad commit -m "feat: configure updater endpoint and signing pubkey"
```

---

### Task 3: Create download landing page

**Files:**
- Create: `site/index.html`

- [ ] **Step 1: Create `site/index.html`**

Create `D:\Projects\scratchpad\site\index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ScratchPad — Download</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1e1e1e;
      color: #d4d4d4;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      max-width: 480px;
      width: 100%;
      padding: 48px 40px;
      text-align: center;
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 32px; font-weight: 700; color: #fff; margin-bottom: 8px; }
    .tagline { color: #888; font-size: 16px; margin-bottom: 40px; line-height: 1.5; }
    .btn {
      display: inline-block;
      background: #0e639c;
      color: #fff;
      text-decoration: none;
      padding: 14px 32px;
      border-radius: 4px;
      font-size: 15px;
      font-weight: 600;
    }
    .btn:hover { background: #1177bb; }
    .platform { font-size: 12px; color: #666; margin-top: 10px; }
    .features {
      margin-top: 40px;
      text-align: left;
      font-size: 14px;
      color: #888;
      line-height: 2;
    }
    .features li { list-style: none; }
    .features li::before { content: '✓  '; color: #0e639c; }
    .source { margin-top: 32px; font-size: 12px; color: #555; }
    .source a { color: #555; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">📝</div>
    <h1>ScratchPad</h1>
    <p class="tagline">A lightweight tabbed notepad for Windows.<br>Quick notes, stored locally — nothing leaves your computer.</p>

    <a href="https://github.com/Dimagithub/scratchpad/releases/download/v0.1.0/ScratchPad_0.1.0_x64-setup.exe"
       class="btn">⬇ Download for Windows</a>
    <p class="platform">Windows 10/11 · x64 · v0.1.0</p>

    <ul class="features">
      <li>Tabbed notepads</li>
      <li>Privacy mode — hide note contents</li>
      <li>Always on top</li>
      <li>Adjustable opacity</li>
      <li>Dark &amp; light theme</li>
      <li>Auto-saves while you type</li>
      <li>Minimises to system tray</li>
    </ul>

    <p class="source"><a href="https://github.com/Dimagithub/scratchpad">View source on GitHub</a></p>
  </div>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git -C D:\Projects\scratchpad add site/index.html
git -C D:\Projects\scratchpad commit -m "feat: add download landing page"
```

---

### Task 4: Create GitHub Actions deploy workflow

**Files:**
- Create: `.github/workflows/deploy-site.yml`

- [ ] **Step 1: Create `.github/workflows/deploy-site.yml`**

Create `D:\Projects\scratchpad\.github\workflows\deploy-site.yml`:

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

      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./site
          force_orphan: true
```

The `force_orphan: true` keeps the `gh-pages` branch as a single commit (no history bloat from binary updates).
The `paths: site/**` filter means the workflow only runs when site files change — not on every commit.

- [ ] **Step 2: Commit**

```bash
git -C D:\Projects\scratchpad add .github/workflows/deploy-site.yml
git -C D:\Projects\scratchpad commit -m "ci: add GitHub Pages deploy workflow"
```

---

### Task 5: Build signed installer and create latest.json

**Files:**
- Create: `site/latest.json`

This task signs the NSIS installer and creates the updater manifest. Must be done after Tasks 1 and 2.

- [ ] **Step 1: Set signing env vars and build**

```powershell
cd D:\Projects\scratchpad
$keyBytes = [System.IO.File]::ReadAllBytes("$HOME\.tauri\scratchpad.key")
$env:TAURI_SIGNING_PRIVATE_KEY = [Convert]::ToBase64String($keyBytes)
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
npm run tauri:build 2>&1
```

Expected: build succeeds, ending with:
```
Finished 2 bundles at:
    D:\...\bundle\msi\ScratchPad_0.1.0_x64_en-US.msi
    D:\...\bundle\nsis\ScratchPad_0.1.0_x64-setup.exe
```

Also creates signature files:
- `src-tauri/target/release/bundle/nsis/ScratchPad_0.1.0_x64-setup.exe.sig`

- [ ] **Step 2: Read the signature**

```powershell
$sig = Get-Content "D:\Projects\scratchpad\src-tauri\target\release\bundle\nsis\ScratchPad_0.1.0_x64-setup.exe.sig" -Raw
Write-Host "Signature:"
Write-Host $sig
```

Copy the entire signature string printed.

- [ ] **Step 3: Create `site/latest.json`**

Create `D:\Projects\scratchpad\site\latest.json` with the signature from Step 2 and today's date:

```json
{
  "version": "0.1.0",
  "notes": "Initial release",
  "pub_date": "2026-06-13T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<paste full contents of .sig file here>",
      "url": "https://github.com/Dimagithub/scratchpad/releases/download/v0.1.0/ScratchPad_0.1.0_x64-setup.exe"
    }
  }
}
```

Replace `<paste full contents of .sig file here>` with the signature string from Step 2. The signature is a single line like:
```
dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHNpZ25hdHVyZQAAAABxxxxxxxx...==
```

- [ ] **Step 4: Verify the JSON is valid**

```powershell
Get-Content D:\Projects\scratchpad\site\latest.json | ConvertFrom-Json | Select-Object version, notes, pub_date
```

Expected:
```
version : 0.1.0
notes   : Initial release
pub_date: 2026-06-13T00:00:00Z
```

- [ ] **Step 5: Commit and push everything**

```bash
git -C D:\Projects\scratchpad add site/latest.json
git -C D:\Projects\scratchpad commit -m "feat: add updater manifest with signed v0.1.0"
git -C D:\Projects\scratchpad push origin main
```

The push triggers the GitHub Actions deploy workflow.

---

### Task 6: Create GitHub Release and configure Pages

**Files:** none (GitHub configuration)

- [ ] **Step 1: Create the v0.1.0 GitHub Release and upload the installer**

```bash
gh release create v0.1.0 \
  "D:\Projects\scratchpad\src-tauri\target\release\bundle\nsis\ScratchPad_0.1.0_x64-setup.exe" \
  --title "v0.1.0 — Initial Windows release" \
  --notes "First Windows build. Includes tabbed notepads, privacy mode, always-on-top, opacity control, and dark/light theme."
```

Expected: URL printed, e.g. `https://github.com/Dimagithub/scratchpad/releases/tag/v0.1.0`

- [ ] **Step 2: Verify the installer URL matches latest.json**

The release asset URL must exactly match what's in `site/latest.json`. Confirm:
```bash
gh release view v0.1.0 --json assets --jq '.assets[].browserDownloadUrl'
```

Expected:
```
https://github.com/Dimagithub/scratchpad/releases/download/v0.1.0/ScratchPad_0.1.0_x64-setup.exe
```

- [ ] **Step 3: Configure GitHub Pages in repo settings**

Open in browser:
```
https://github.com/Dimagithub/scratchpad/settings/pages
```

Set:
- **Source**: Deploy from a branch
- **Branch**: `gh-pages` / `/ (root)`
- Click **Save**

> Note: The `gh-pages` branch is created by the Actions workflow in Task 4/5. If it hasn't run yet, wait for it to complete (check at `https://github.com/Dimagithub/scratchpad/actions`) before configuring Pages.

- [ ] **Step 4: Verify the download page is live**

Wait ~60 seconds after configuring Pages, then open:
```
https://dimagithub.github.io/scratchpad/
```

Expected: download page loads, "Download for Windows" button visible.

- [ ] **Step 5: Verify the updater endpoint is live**

```bash
curl https://dimagithub.github.io/scratchpad/latest.json
```

Expected: JSON with `version`, `platforms.windows-x86_64.signature`, and the download URL.

---

## Release checklist (for future versions)

When releasing a new version:

1. Bump `"version"` in `src-tauri/tauri.conf.json` and `package.json`
2. Build with signing:
   ```powershell
   $keyBytes = [System.IO.File]::ReadAllBytes("$HOME\.tauri\scratchpad.key")
   $env:TAURI_SIGNING_PRIVATE_KEY = [Convert]::ToBase64String($keyBytes)
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
   npm run tauri:build
   ```
3. Create GitHub Release, upload new `.exe`:
   ```bash
   gh release create v<version> "path/to/ScratchPad_<version>_x64-setup.exe" --title "v<version>" --notes "..."
   ```
4. Update `site/latest.json`: bump `version`, `pub_date`, paste new `.sig` contents, update URL
5. Update `site/index.html`: bump version number and download URL
6. `git add site/ && git commit -m "release: v<version>" && git push`

---

## Self-review

**Spec coverage:**
- GitHub Pages site → Tasks 3, 4, 5, 6 ✓
- `site/index.html` → Task 3 ✓
- `site/latest.json` → Task 5 ✓
- `deploy-site.yml` workflow → Task 4 ✓
- Signing keypair generation → Task 1 ✓
- `tauri.conf.json` pubkey + endpoint → Task 2 ✓
- GitHub Release for v0.1.0 → Task 6 ✓
- GitHub Pages configuration → Task 6 ✓

**Placeholders:** `site/latest.json` in Task 5 has a `<paste...>` placeholder — this is intentional and unavoidable (signature comes from a runtime build artifact). The step explicitly tells the executor to run Step 2 first and paste the output. Not a plan failure.

**Type consistency:** `ScratchPad_0.1.0_x64-setup.exe` used consistently in Tasks 5 and 6. Endpoint URL `https://dimagithub.github.io/scratchpad/latest.json` consistent between Task 2 and the spec.
