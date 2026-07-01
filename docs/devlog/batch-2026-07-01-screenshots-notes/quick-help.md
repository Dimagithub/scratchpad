# Quick Help panel

## What was added

- **Help button**: `?` button in the toolbar (data-testid `help-button`, title
  "Help"), placed immediately before the `+` new-note button. Always visible
  (not gated on an active note), matching the `+` button's visibility rule.
- **Help modal**: dismissible overlay (state `helpOpen` in `App.tsx`),
  data-testid `help-modal` — a fixed, full-viewport semi-transparent backdrop
  (`rgba(0,0,0,0.5)`) with a centered card. Styled via the existing
  `getStyles(theme, opacity, tabPosition)` factory (new `helpBackdrop`,
  `helpCard`, `helpHeader`, `helpBody`, `helpSectionTitle`, `helpRow`,
  `helpKey` entries), so it follows dark/light theme automatically — no
  hardcoded theme.
- **Dismissal**: × button (data-testid `help-close`), clicking the backdrop
  (click handler on the backdrop; the card itself calls `stopPropagation`),
  or `Escape`.
- **Keyboard shortcut**: `?` (Shift+/) toggles the modal; guarded so it only
  fires when the keydown target isn't an `<input>`/`<textarea>`, so typing
  "?" in a note or the rename/search fields is unaffected. `Escape` was
  extended so that when `helpOpen` is true it closes the help modal first
  (the modal sits visually on top); otherwise it falls through to the
  pre-existing search-close behavior. `⌘F` is untouched.
- **Content** (verified against the actual code, not invented):
  - Notes: `+` for a new note, double-click a tab title to rename, `×` to
    close a tab, Markdown authoring.
  - Find: `⌘F` or the 🔍 button, case toggle (Aa), `↑`/`↓` or `⏎`/`⇧⏎` to
    cycle matches.
  - Screenshots: 📷 button or `⌃⌘4`, copied to clipboard + saved to the
    Screenshots tab; gallery thumbnail opens full-size; Copy / Delete /
    Delete all.
  - Markdown: 👁 toggles split live preview, Validate (✓) lints, 📋 copies
    note text.
  - Privacy: 🔒/🔓 button or View → Privacy Mode masks note content.
  - Window & View: menu bar View → Tab Position (Top/Left/Right), Theme,
    Opacity, Always on Top; `⌘⇧S` shows/focuses the window from anywhere
    (confirmed against `src-tauri/src/lib.rs`'s global shortcut + menu
    builder).
  - Shortcuts rendered as `<kbd>`-styled spans; two-column `action | keys`
    rows for Find/Screenshots/Markdown/Window sections.

## Files changed

- `src/App.tsx` — `helpOpen` state, keydown handler updates, toolbar `?`
  button, `helpModal` JSX (rendered as the first child inside
  `data-testid="app-root"` so it overlays all three tab-position layouts),
  and new style entries in `getStyles`.
- `tests/help.spec.ts` (new) — 5 tests: help button visible, opening shows
  recognizable content ("⌘F", "Screenshots"), × closes, Escape closes, `?`
  opens.
- No changes to `tests/mocks/tauri-ipc.js` — pure frontend feature, no new
  Tauri command.

## Test output

`node_modules/.bin/tsc --noEmit` — clean, no errors.

`npm run build` — succeeds:
```
✓ 35 modules transformed.
src-tauri/dist/assets/index-BptjiIu8.js   291.40 kB │ gzip: 92.26 kB
✓ built in 386ms
```

`cargo test --manifest-path src-tauri/Cargo.toml --lib` — unchanged, still:
```
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

`npx playwright test` — all green, including the 5 new help tests:
```
51 passed (6.9s)
```
