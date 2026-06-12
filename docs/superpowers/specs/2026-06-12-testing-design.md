# Testing Design

**Date:** 2026-06-12  
**Status:** Approved

## Overview

Add a full test suite to ScratchPad: Rust unit tests for the data layer, and Playwright tests for the React frontend and all user-facing workflows. No Vitest — Playwright handles both component-level behavior and E2E flows. Tests run locally against the Vite dev server.

---

## Layer 1: Rust Unit Tests

**Location:** `src-tauri/src/lib.rs` — `#[cfg(test)]` module at the bottom  
**Run:** `cd src-tauri && cargo test`

### What to test

| Test | What it verifies |
|---|---|
| `settings_defaults_from_empty_json` | `AppSettings` deserialized from `{}` produces `always_on_top: false`, `opacity: 1.0`, `theme: "dark"` |
| `settings_partial_json_fills_defaults` | JSON with only `storage_path` fills the other three fields with defaults |
| `settings_roundtrip` | Serialize `AppSettings` → write to tempdir → read back → values match |
| `note_private_defaults_false` | `Note` deserialized from JSON without `private` field gets `private: false` |
| `note_full_roundtrip` | Serialize `Note` with all fields → deserialize → equals original |
| `default_storage_path_uses_userprofile` | When `HOME` is unset, `default_storage_path()` falls back to `USERPROFILE` |

All tests use `tempfile::TempDir` or `std::env::set_var` for isolation. No Tauri runtime required — tested code is pure serde + std::fs logic.

Add `tempfile = "3"` to `[dev-dependencies]` in `Cargo.toml`.

---

## Layer 2: Playwright Tests

**Location:** `tests/` at repo root  
**Config:** `playwright.config.ts` — uses `webServer` to start `npm run dev` (Vite on port 1420), waits for it, then runs tests against `http://localhost:1420`  
**Run:** `npx playwright test`

### Tauri IPC Mock

**File:** `tests/mocks/tauri-ipc.ts`

Injected via `page.addInitScript({ path: 'tests/mocks/tauri-ipc.ts' })` in a global `beforeEach`. Sets up `window.__TAURI_INTERNALS__` with:

**In-memory `invoke` handlers:**
- `get_notes` → returns current in-memory note array
- `create_new_note` → creates note with UUID, timestamp, title `"Notepad <date>"`, `private: false`; appends to array; returns note
- `save_note` → upserts by ID
- `delete_note` → filters out by `noteId`
- `rename_note` → finds by `noteId`, updates `title`
- `get_settings` → returns `{ theme: "dark", always_on_top: false, opacity: 1.0, storage_path: "" }`

**Event bus:**
- `listen(event, callback)` → registers callback, returns async unlisten function
- `window.__TEST_EMIT__(event, payload)` → fires all registered callbacks for that event

**State reset:**
- `window.__TEST_RESET__()` → clears note array and all listeners (called in `beforeEach`)

### Test Files

#### `tests/notes.spec.ts`

| Test | Steps | Assert |
|---|---|---|
| Auto-creates first note on load | Navigate to app | One tab visible, tab title matches date format |
| Add note | Click `+` button | Second tab appears |
| Switch tabs | Click second tab | Tab becomes active (border-bottom accent color) |
| Close note | Click `×` on a tab | Tab disappears, adjacent tab becomes active |
| Close last note | Click `×` on only tab | Empty state shown ("No notepads open") |
| Rename note | Double-click tab title, type "My Note", press Enter | Tab title updates to "My Note" |
| Rename cancel | Double-click tab, type, press Escape | Title reverts |
| Content persists on tab switch | Type in tab A, switch to tab B, switch back to tab A | Original content still shown |

#### `tests/privacy.spec.ts`

| Test | Steps | Assert |
|---|---|---|
| Privacy masks content | Create note, type "secret", emit `toggle-privacy` | Textarea shows `•••••••` (7 bullets), `readonly` attribute present |
| Privacy textarea is not editable | Enable privacy, click textarea, try typing | Text does not change |
| Privacy toggle restores editing | Enable privacy, emit `toggle-privacy` again | Textarea editable, shows original content |
| Privacy survives tab switch | Enable privacy on tab A, switch to tab B, switch back | Tab A still masked |

#### `tests/theme.spec.ts`

| Test | Steps | Assert |
|---|---|---|
| Default is dark | Load app | Root background is `rgba(30, 30, 30` (contains this substring) |
| Switch to light | Emit `settings-changed` with `{ theme: "light" }` | Root background is `rgba(255, 255, 255` |
| Switch back to dark | Emit `settings-changed` with `{ theme: "dark" }` | Root background is `rgba(30, 30, 30` |
| Opacity changes background alpha | Emit `settings-changed` with `{ opacity: 0.5 }` | Background alpha value is `0.5` |

---

## Dependencies to Add

**Frontend (package.json devDependencies):**
- `@playwright/test` — `^1.x`

**Rust (Cargo.toml dev-dependencies):**
- `tempfile` — `"3"`

---

## npm Scripts to Add

```json
"test": "playwright test",
"test:rust": "cd src-tauri && cargo test"
```

---

## Out of Scope

- CI configuration
- Native menu interaction tests (requires full Tauri binary)
- Screenshot/visual regression tests
- Always-on-top / opacity window tests (OS-level, not testable in browser)
