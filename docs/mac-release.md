# Building and Publishing a macOS Release

## Prerequisites

- Mac with Xcode command line tools (`xcode-select --install`)
- Node.js + npm
- Rust (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)
- GitHub CLI (`brew install gh` + `gh auth login`)
- The signing private key from Windows (`~/.tauri/scratchpad.key`)

## One-time: transfer signing key from Windows

Copy `C:\Users\<you>\.tauri\scratchpad.key` to `~/.tauri/scratchpad.key` on the Mac.
Both platforms must use the same key — it must match the `pubkey` in `tauri.conf.json`.

```bash
mkdir -p ~/.tauri
# scp, AirDrop, or paste the file contents manually
```

## Build

```bash
git clone https://github.com/Dimagithub/scratchpad.git  # or git pull
cd scratchpad
npm install

export TAURI_SIGNING_PRIVATE_KEY_PATH="$HOME/.tauri/scratchpad.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
npm run tauri:build
```

Output: `src-tauri/target/release/bundle/dmg/ScratchPad_0.1.0_aarch64.dmg`

## Sign the DMG

```bash
npx tauri signer sign \
  --private-key-path ~/.tauri/scratchpad.key \
  --password "" \
  src-tauri/target/release/bundle/dmg/ScratchPad_0.1.0_aarch64.dmg
```

Creates `ScratchPad_0.1.0_aarch64.dmg.sig` next to the DMG.

## Upload to GitHub Release

```bash
gh release upload v0.1.0 \
  src-tauri/target/release/bundle/dmg/ScratchPad_0.1.0_aarch64.dmg \
  --clobber
```

## Update site/latest.json

Add a `darwin-aarch64` entry. Paste the full contents of the `.sig` file into `signature`:

```json
{
  "version": "0.1.0",
  "notes": "Initial release",
  "pub_date": "2026-06-13T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<existing windows signature>",
      "url": "https://github.com/Dimagithub/scratchpad/releases/download/v0.1.0/ScratchPad_0.1.0_x64-setup.exe"
    },
    "darwin-aarch64": {
      "signature": "<contents of .sig file>",
      "url": "https://github.com/Dimagithub/scratchpad/releases/download/v0.1.0/ScratchPad_0.1.0_aarch64.dmg"
    }
  }
}
```

## Push

```bash
git add site/latest.json
git commit -m "release: add macOS aarch64 to v0.1.0 updater manifest"
git push
```

GitHub Actions deploys the updated `latest.json` automatically.

## For future versions (checklist)

1. Bump `version` in `src-tauri/tauri.conf.json` and `package.json`
2. Build with signing env vars (`TAURI_SIGNING_PRIVATE_KEY_PATH` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`)
3. Sign the DMG with `npx tauri signer sign`
4. Create GitHub Release: `gh release create v<version> <dmg> <exe> --title "..." --notes "..."`
5. Update `site/latest.json` — bump version, pub_date, signatures, URLs for both platforms
6. Update `site/index.html` — bump version number and download URLs
7. `git add site/ && git commit -m "release: v<version>" && git push`
