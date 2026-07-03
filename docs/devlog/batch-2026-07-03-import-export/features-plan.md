# Features Plan — Import / Export files

Batch: 2026-07-03

Two non-trivial features from `docs/todo.md` #approved:

- **Feature #1** — Export a note to a file on disk ("save as file").
- **Feature #2** — Import any file (csv/md/txt/json) as a new note, including
  macOS file-association (double-click / "Open With" ScratchPad).

Both are one-time, one-way operations — no live link is kept between a note
and a file on disk in either direction. This mirrors how notes already work
(app-managed content in `notes.json`); it avoids external-change detection,
conflict resolution, and path-dedup logic entirely.

---

## Feature #1 — Export note to file

### Goal
Let the user write the active note's content to an arbitrary path via a
native save dialog, as a one-time snapshot.

### Backend (src-tauri/src/lib.rs)
- New command `export_note(path: String, content: String) -> Result<(), String>`
  — `fs::write(path, content)`, mapping errors to strings (matches the style
  of every other command in the file).
- Add `last_import_export_dir: Option<String>` to `AppSettings`
  (`#[serde(default)]`), included in `Default for AppSettings`. Shared
  between Export and Import so both remember the same last-used folder.
- New menu item `export_note` ("Export…") in the File submenu. Handled in
  `on_menu_event`:
  1. Read `state.settings.lock()` for the current `last_import_export_dir`.
  2. Open `app.dialog().file().set_directory(dir).set_file_name(default_name)`
     save dialog (blocking, via the existing `tauri_plugin_dialog` pattern
     already used for the delete-confirmation dialog).
  3. On a chosen path: emit an event to the frontend (`"export-note-to"`,
     payload `{ path }`) — the frontend owns the active note's live content
     (including unsaved keystrokes), so it performs the actual
     `invoke("export_note", { path, content })` call and then
     `invoke("set_last_import_export_dir", { dir })` to persist the parent
     directory into settings.

### Frontend (src/App.tsx)
- New File-menu-triggered flow: listen for `"export-note-to"` via
  `useTauriEvent`, call `export_note` with `activeNote.content`, show a
  message dialog on failure (reuse the existing error-dialog pattern).
- The default filename is computed in Rust (the File menu and its dialog
  live entirely on the Rust side), from the active note's title and whether
  markdown preview is *currently* toggled on — not whether it was ever used.
  Rust doesn't otherwise know the active note or the preview state, so the
  frontend keeps it informed:
  - Add `active_note_title: Mutex<String>` and `preview_on: Mutex<bool>` to
    `AppState`, updated by one new lightweight command
    `set_active_note_context(title: String, preview_on: bool)`, called from
    the frontend whenever the active note or the `showPreview` toggle
    changes. The Export menu handler reads these to build the default
    filename: sanitize the title (strip `/`, trim, fallback to `"Untitled"`),
    append `.md` if `preview_on` else `.txt`.
- Sanitization helper (Rust, private fn): replace `/` and control characters,
  trim to a reasonable length.

### Error handling
- Write failure (permissions, disk full): `console.error`, same as every
  other note-mutation failure in the app today (`save_note`, `rename_note`,
  `delete_note` all fail silently-to-console, no dialog) — no reason for
  Export to be the one exception.
- User cancels the save dialog: no-op, nothing emitted.

### Tests
- Rust `#[cfg(test)]`: `export_note` writes exact content to a temp path;
  overwrite of an existing file succeeds.
- Playwright: mock the dialog module (already mocked in
  `tests/mocks/tauri-ipc.js` for existing dialog-driven flows) to assert
  `export_note` is invoked with the active note's current content when the
  Export flow fires.

---

## Feature #2 — Import file as new note (+ macOS file association)

### Goal
Create a new note from an existing text file's contents, triggerable from
the File menu ("Import…") and from macOS itself (double-click / Open With)
for `.csv`, `.md`, `.txt`, `.json`.

### Backend (src-tauri/src/lib.rs)
- New command `import_file(path: String, settings: State<AppState>) -> Result<Note, String>`:
  - `fs::read(path)` then `String::from_utf8`, mapping a decode failure to
    `Err("Could not read file as text")`.
  - Title = file stem (filename without extension); content = the decoded
    text. Builds a `Note` exactly like `create_new_note` (new UUID, current
    `created_at`, `private: false`), pushes it via `load_notes`/`store_notes`
    on `settings.storage_path`, returns the `Note`.
  - Updates `last_import_export_dir` in settings to the file's parent dir
    (shared field with Export), via `save_settings`.
- New menu item `import_file` ("Import…") in the File submenu. Handler opens
  `app.dialog().file()` with an extension filter
  (`add_filter("Text files", &["csv", "md", "txt", "json"])` plus the
  dialog's built-in "All Files" option), defaulting to
  `last_import_export_dir`. On a chosen path, calls `import_file` directly
  (no content round-trip needed here — Rust reads the file itself), then
  `app.emit("note-imported", note)` so the frontend adds it to `notes` state
  and switches to it as the active tab.
- **macOS file association**: add to `tauri.conf.json` under `bundle`:
  ```json
  "fileAssociations": [
    { "ext": ["csv", "md", "txt", "json"], "name": "Text Document", "role": "Editor" }
  ]
  ```
  In `.run()`, handle `tauri::RunEvent::Opened { urls, .. }` (fires on both
  cold start with a file argument and while already running): convert each
  URL to a path, call the same `import_file` logic, `app.emit("note-imported", note)`.
  Extract the shared logic into one function used by both the menu handler
  and the `Opened` handler.

### Frontend (src/App.tsx)
- Listen for `"note-imported"` via `useTauriEvent<Note>`: append to `notes`
  state, set it active, matches how `create_new_note`'s result is already
  handled for the "+" button.
- No new UI beyond the File-menu item — the dialog and file reading are
  fully native/Rust-side.

### Error handling
- Non-UTF8 file: dialog error message "Could not read file as text", no note
  created.
- User cancels the import dialog: no-op.

### Tests
- Rust `#[cfg(test)]`: `import_file` on a temp `.txt` produces a `Note` with
  matching content and filename-derived title; on a file with invalid UTF-8
  bytes returns the expected `Err`.
- Playwright: simulate a `"note-imported"` event payload and assert it
  appears as a new active tab (same pattern as existing note-creation tests).
- File-association config itself (`tauri.conf.json` + the `Opened` event)
  can't be exercised by Playwright (no packaged app, no Finder) — flagged as
  a manual verification step: build the app, double-click a `.txt` file in
  Finder, confirm it opens ScratchPad with the content as a new note.

---

## Shared groundwork

- `AppSettings.last_import_export_dir: Option<String>` — used by both
  features, defaults to `None` (dialogs fall back to `~/Documents` when
  `None`).
- `AppState.active_note_title` / `active_note_context` tracking — new, only
  needed for Export's default filename. Kept minimal (two primitives behind
  the existing `Mutex` pattern in `AppState`), not a general "sync frontend
  state to Rust" mechanism.

## Out of scope (explicitly, per approved design)
- Live-linked/file-backed notes (editing writing back to the original file).
- CSV table rendering, JSON pretty-printing, or any format-specific UI —
  all four types are treated as plain text.
- Dedup / "already imported this file" detection.
- Windows/Linux file association (todo.md scopes this to "associate it in
  Mac OS").
