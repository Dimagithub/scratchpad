# Tauri Updater Signing — Agent Instructions (ScratchPad)

**Read this before any release build or anything touching `TAURI_SIGNING_*`.**

## Universal rules (apply to every Tauri app)

1. **Per-project keys. Never set a global `TAURI_SIGNING_PRIVATE_KEY`** (e.g. in
   `~/.zshrc`). A global key signs *every* Tauri app with the same key and breaks
   the updater signature for all but one of them.
2. **`TAURI_SIGNING_PRIVATE_KEY` holds the key _contents_, not a path.** Tauri v2
   base64-decodes the value, so a path fails with
   `failed to decode base64 secret key`. `TAURI_SIGNING_PRIVATE_KEY_PATH` is a
   Tauri v1 name and is **ignored** by the v2 build — do not use it.
3. The key loads from a gitignored **`.envrc`** (direnv), which `cat`s the file:
   ```sh
   export TAURI_SIGNING_PRIVATE_KEY="$(cat /Users/dima/.tauri/scratchpad.key)"
   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
   ```
   Run `direnv allow` once per checkout/worktree. Do **not** put the key path in
   `.env` (dotenv passes it as a literal string → signing fails).
4. The key in `~/.tauri/<app>.key` **must** match the `pubkey` in
   `src-tauri/tauri.conf.json`. If a build prints *"the updater secret key … does
   not match the public key from plugins > updater > pubkey"*, the wrong key was
   used — fix the env and rebuild; do not ship.

## This app: ScratchPad

- Key: `~/.tauri/scratchpad.key` (empty password)
- Pubkey id: `D8C3AEA07BDF89C3`
- Updater: **active**
- `.envrc` is **committed** in this repo and already correct — just `direnv allow`.
- Full release process: **`docs/mac-release.md`** (build → sign → GitHub release →
  update `site/latest.json` + `site/index.html` → push).
