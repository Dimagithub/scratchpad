# Import / Export Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a ScratchPad user export the active note to a file on disk ("Export…"), and import any `.csv`/`.md`/`.txt`/`.json` file as a new note ("Import…" menu item or macOS double-click/Open With).

**Architecture:** Both operations are one-time, one-way file<->note conversions — no live link is kept afterward (matches spec decision in `features-plan.md`). All file I/O, the File-menu items, and the native dialogs live in Rust (`src-tauri/src/lib.rs`); the frontend only reacts to two events (`export-note-to`, `note-imported`) and keeps Rust informed of the active note's title/preview state so the Export dialog can build a sensible default filename.

**Tech Stack:** Tauri 2 (`tauri-plugin-dialog`, already a dependency), React 19, Playwright, Rust `#[cfg(test)]` + `tempfile`.

## Global Constraints

- No live link between a note and an exported/imported file — every write is a one-time snapshot (spec: "Out of scope").
- All 4 supported extensions (`csv`, `md`, `txt`, `json`) are treated as plain text — no format-specific parsing/rendering (spec: "Out of scope").
- Menu items are labeled **"Import…"** and **"Export…"** (not "Open…"/"Save As…"), no keyboard shortcuts (per approved design).
- File-association is macOS-only (spec: "Out of scope" for Windows/Linux).
- Follow existing code style exactly: commands return `Result<T, String>` with `.map_err(|e| e.to_string())`; menu handlers live in the single `on_menu_event` closure in `run()`; settings mutate via `state.settings.lock()` + `save_settings(&s)`.

---

### Task 1: Export backend — settings field, `export_note` command, default-filename logic

**Files:**
- Modify: `src-tauri/src/lib.rs` (currently 863 lines — see anchors below, not fixed line numbers, since earlier edits shift later line numbers)
- Test: same file, `mod tests` block at the bottom

**Interfaces:**
- Produces: `AppSettings.last_import_export_dir: Option<String>` (new field, shared with Task 4/5's Import path)
- Produces: `fn sanitize_filename(name: &str) -> String` (private)
- Produces: `fn default_export_filename(title: &str, preview_on: bool) -> String` (private)
- Produces: `#[tauri::command] fn export_note(path: String, content: String) -> Result<(), String>`

- [ ] **Step 1: Write the failing tests**

Add to the `mod tests` block at the bottom of `src-tauri/src/lib.rs` (after the existing `storage_path_uses_platform_home` test):

```rust
    #[test]
    fn settings_default_last_import_export_dir_is_none() {
        let s: AppSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(s.last_import_export_dir, None);
    }

    #[test]
    fn settings_last_import_export_dir_roundtrips() {
        let mut original = AppSettings::default();
        original.last_import_export_dir = Some("/Users/dima/Documents".to_string());
        let json = serde_json::to_string_pretty(&original).unwrap();
        let loaded: AppSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(loaded.last_import_export_dir, original.last_import_export_dir);
    }

    #[test]
    fn sanitize_filename_strips_slashes_and_trims() {
        assert_eq!(sanitize_filename("Notepad Jul 3, 10:30"), "Notepad Jul 3, 10:30");
        assert_eq!(sanitize_filename("a/b/c"), "abc");
        assert_eq!(sanitize_filename("  padded  "), "padded");
        assert_eq!(sanitize_filename(""), "Untitled");
        assert_eq!(sanitize_filename("   "), "Untitled");
    }

    #[test]
    fn default_export_filename_picks_extension_from_preview_state() {
        assert_eq!(default_export_filename("My Note", false), "My Note.txt");
        assert_eq!(default_export_filename("My Note", true), "My Note.md");
        assert_eq!(default_export_filename("", true), "Untitled.md");
    }

    #[test]
    fn export_note_writes_exact_content() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("out.txt");
        export_note(path.to_string_lossy().into_owned(), "hello world".to_string()).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "hello world");
    }

    #[test]
    fn export_note_overwrites_existing_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("out.txt");
        std::fs::write(&path, "old").unwrap();
        export_note(path.to_string_lossy().into_owned(), "new".to_string()).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
    }
```

- [ ] **Step 2: Run tests to verify they fail (compile error — nothing exists yet)**

Run: `cd src-tauri && cargo test --lib`
Expected: FAIL to compile — `cannot find field last_import_export_dir`, `cannot find function sanitize_filename` etc.

- [ ] **Step 3: Add the settings field**

In `src-tauri/src/lib.rs`, find the `AppSettings` struct (has fields `storage_path`, `always_on_top`, `opacity`, `theme`, `tab_position`) and add a new field after `tab_position`:

```rust
    #[serde(default = "default_tab_position")]
    pub tab_position: String,
    #[serde(default)]
    pub last_import_export_dir: Option<String>,
}
```

In `impl Default for AppSettings`, add the matching field after `tab_position: "top".to_string(),`:

```rust
            tab_position: "top".to_string(),
            last_import_export_dir: None,
        }
    }
}
```

- [ ] **Step 4: Add the filename helpers and `export_note` command**

Add this right after the `save_settings` function (which writes `settings.json` — keep the new file-I/O helpers grouped near it, before `get_settings`):

```rust
// Strips characters unsafe/awkward in filenames, trims whitespace, and
// falls back to "Untitled" so Export never offers an empty filename.
fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| *c != '/' && *c != '\\' && !c.is_control())
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "Untitled".to_string()
    } else {
        trimmed.chars().take(100).collect()
    }
}

// preview_on reflects whether markdown preview is *currently* toggled on for
// the active note (not whether it was ever used) — see features-plan.md.
fn default_export_filename(title: &str, preview_on: bool) -> String {
    let ext = if preview_on { "md" } else { "txt" };
    format!("{}.{}", sanitize_filename(title), ext)
}

#[tauri::command]
fn export_note(path: String, content: String) -> Result<(), String> {
    fs::write(path, content).map_err(|e| format!("Failed to export note: {}", e))
}
```

- [ ] **Step 5: Register the new command**

In the `invoke_handler(tauri::generate_handler![...])` list near the bottom of `run()`, add `export_note,` after `copy_text,`:

```rust
            play_sound,
            copy_text,
            export_note,
        ])
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --lib`
Expected: PASS — all 7 new tests plus the existing suite green.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: export_note command + default-filename logic

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Export UI wiring — active-note context, File menu item, dialog handler

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `default_export_filename(title: &str, preview_on: bool) -> String` (Task 1), `AppSettings.last_import_export_dir` (Task 1)
- Produces: `AppState.active_note_title: Mutex<String>`, `AppState.preview_on: Mutex<bool>`
- Produces: `#[tauri::command] fn set_active_note_context(title: String, preview_on: bool, state: State<AppState>)`
- Produces: menu item id `"export_note"` in the File submenu; on click, emits Tauri event `"export-note-to"` with a `String` payload (the chosen absolute path)

This task is glue code (native menu + native dialog) with no unit-testable pure logic beyond what Task 1 already covers — its "test" is a successful build plus the manual check in Step 6.

- [ ] **Step 1: Add the two new `AppState` fields**

Find `pub struct AppState { pub settings: Mutex<AppSettings>, }` and change it to:

```rust
#[derive(Default)]
pub struct AppState {
    pub settings: Mutex<AppSettings>,
    pub active_note_title: Mutex<String>,
    pub preview_on: Mutex<bool>,
}
```

(`Mutex<String>` and `Mutex<bool>` both implement `Default`, so `#[derive(Default)]` still works — no other change needed.)

- [ ] **Step 2: Add the `set_active_note_context` command**

Add it right after `set_privacy_menu_state`:

```rust
#[tauri::command]
fn set_active_note_context(title: String, preview_on: bool, state: State<AppState>) {
    *state.active_note_title.lock().unwrap() = title;
    *state.preview_on.lock().unwrap() = preview_on;
}
```

- [ ] **Step 3: Register the command**

In `invoke_handler(tauri::generate_handler![...])`, add `set_active_note_context,` after `export_note,`.

- [ ] **Step 4: Add the "Export…" menu item**

Find where the File submenu is built:

```rust
            let open_notes_folder = MenuItemBuilder::with_id("open_notes_folder", "Open Notes Folder").build(app)?;
            let file_submenu = SubmenuBuilder::new(app, "File")
                .item(&open_notes_folder)
                .separator()
                .close_window()
                .build()?;
```

Replace it with:

```rust
            let import_file_item = MenuItemBuilder::with_id("import_file", "Import…").build(app)?;
            let export_note_item = MenuItemBuilder::with_id("export_note", "Export…").build(app)?;
            let open_notes_folder = MenuItemBuilder::with_id("open_notes_folder", "Open Notes Folder").build(app)?;
            let file_submenu = SubmenuBuilder::new(app, "File")
                .item(&import_file_item)
                .item(&export_note_item)
                .separator()
                .item(&open_notes_folder)
                .separator()
                .close_window()
                .build()?;
```

(`import_file_item` is added now so Task 5 only needs to wire its handler, not touch the menu again.)

- [ ] **Step 5: Add the `export_note` menu handler**

Inside `app.on_menu_event(|app, event| { ... })`, add this block (near the other `if event.id() == "..."` checks, e.g. right after the `open_notes_folder` block):

```rust
                if event.id() == "export_note" {
                    let state = app.state::<AppState>();
                    let default_name = {
                        let title = state.active_note_title.lock().unwrap().clone();
                        let preview_on = *state.preview_on.lock().unwrap();
                        default_export_filename(&title, preview_on)
                    };
                    let last_dir = state.settings.lock().unwrap().last_import_export_dir.clone();

                    let mut dialog = app.dialog().file().set_file_name(&default_name);
                    if let Some(dir) = &last_dir {
                        dialog = dialog.set_directory(dir);
                    }
                    if let Some(picked) = dialog.blocking_save_file() {
                        if let Ok(path) = picked.into_path() {
                            if let Some(parent) = path.parent() {
                                let mut s = state.settings.lock().unwrap();
                                s.last_import_export_dir = Some(parent.to_string_lossy().into_owned());
                                save_settings(&s);
                            }
                            let _ = app.emit("export-note-to", path.to_string_lossy().into_owned());
                        }
                    }
                }
```

- [ ] **Step 6: Build and manually verify**

Run: `cd src-tauri && cargo check`
Expected: builds cleanly. If `blocking_save_file`, `set_file_name`, `set_directory`, or `into_path` don't match the installed `tauri-plugin-dialog` version's API, the compiler error will name the actual method — adjust the call to match (check `cargo doc -p tauri-plugin-dialog --open` for the exact `FileDialogBuilder`/`FilePath` API if needed).

Then run `npm run tauri:dev`, type some text in a note, use File → Export…, confirm a save dialog appears defaulting to `~/Documents` with `<note title>.txt` (or `.md` if preview is toggled on) pre-filled. Don't worry that nothing is written to disk yet — Task 3 wires the frontend side that actually calls `export_note`.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: Export… menu item and native save dialog

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Frontend Export wiring

**Files:**
- Modify: `src/App.tsx`
- Modify: `tests/mocks/tauri-ipc.js`
- Modify: `tests/globals.d.ts`
- Test: Create `tests/export.spec.ts`

**Interfaces:**
- Consumes: Tauri command `export_note(path: string, content: string)` (Task 1), `set_active_note_context(title: string, previewOn: boolean)` (Task 2), event `"export-note-to"` (payload: `string` path) (Task 2)
- Produces: `window.__TEST_LAST_EXPORT__: { path: string; content: string } | null` (test-only hook, mirrors the existing `__TEST_EMIT__`/`__TEST_RESET__` pattern)

- [ ] **Step 1: Write the failing Playwright test**

Create `tests/export.spec.ts`:

```typescript
import { test, expect, Page } from "@playwright/test";

async function load(page: Page) {
  await page.addInitScript({ path: "tests/mocks/tauri-ipc.js" });
  await page.goto("/");
  await page.waitForSelector('[data-testid="tab"]');
}

test.beforeEach(async ({ page }) => {
  await load(page);
});

test("Export writes the active note's live content to the chosen path", async ({ page }) => {
  await page.locator('[data-testid="editor"]').fill("hello export");
  await page.evaluate(() => window.__TEST_EMIT__("export-note-to", "/tmp/out.txt"));

  await expect
    .poll(() => page.evaluate(() => window.__TEST_LAST_EXPORT__))
    .toEqual({ path: "/tmp/out.txt", content: "hello export" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/export.spec.ts`
Expected: FAIL — `window.__TEST_LAST_EXPORT__` is `undefined` (mock doesn't implement `export_note` yet), and TypeScript will also flag the unknown global if you run `npm run build` first.

- [ ] **Step 3: Add the mock command + test hook**

In `tests/mocks/tauri-ipc.js`, add a case to the `dispatch` switch (after `case "copy_text":`):

```javascript
      case "export_note":
        window.__TEST_LAST_EXPORT__ = { path: args.path, content: args.content };
        return Promise.resolve(null);

      case "set_active_note_context":
        return Promise.resolve(null);
```

In `window.__TEST_RESET__`, add a reset line:

```javascript
  window.__TEST_RESET__ = function () {
    notes = [];
    screenshots = [];
    window.__TEST_LAST_EXPORT__ = null;
```

- [ ] **Step 4: Declare the new global for TypeScript**

In `tests/globals.d.ts`:

```typescript
export {};

declare global {
  interface Window {
    __TEST_EMIT__: (event: string, payload: unknown) => void;
    __TEST_RESET__: () => void;
    __TEST_LAST_EXPORT__: { path: string; content: string } | null;
  }
}
```

- [ ] **Step 5: Wire the frontend**

In `src/App.tsx`, add a `contentRef` synced to the live `content` state (so the Export handler always reads the latest keystrokes, not the last-saved/debounced value). Right after the existing `activeIdRef` sync effect:

```typescript
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const contentRef = useRef("");
  useEffect(() => {
    contentRef.current = content;
  }, [content]);
```

Add an effect that pushes the active note's title + preview state to Rust whenever either changes (place it near the other settings-related effects, e.g. after the `set_privacy_menu_state` effect):

```typescript
  useEffect(() => {
    const note = notes.find((n) => n.id === activeId);
    invoke("set_active_note_context", {
      title: note?.title ?? "",
      previewOn: showPreview,
    }).catch(console.error);
  }, [activeId, notes, showPreview]);
```

Add the `"export-note-to"` listener (near the other `useTauriEvent` calls, e.g. after `useTauriEvent<null>("show-help", ...)`):

```typescript
  useTauriEvent<string>("export-note-to", (path) => {
    invoke("export_note", { path, content: contentRef.current }).catch((err) => {
      console.error("Export failed:", err);
    });
  });
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx playwright test tests/export.spec.ts`
Expected: PASS.

- [ ] **Step 7: Run the full test suite to check for regressions**

Run: `npm run test`
Expected: all tests PASS (existing suite + the new one).

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx tests/export.spec.ts tests/mocks/tauri-ipc.js tests/globals.d.ts
git commit -m "feat: wire Export… to export_note with live note content

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Import backend — `import_file` command

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `Note` struct, `load_notes`/`store_notes`, `AppSettings.last_import_export_dir` (Task 1)
- Produces: `#[tauri::command] fn import_file(path: String, settings: State<AppState>) -> Result<Note, String>` — callable directly from Rust (not just via `invoke`), reused by both the File-menu handler (Task 5) and the macOS `RunEvent::Opened` handler (Task 7)

- [ ] **Step 1: Write the failing tests**

Add to `mod tests` (after `export_note_overwrites_existing_file`):

```rust
    fn test_state_with_storage(path: &std::path::Path) -> AppState {
        let mut settings = AppSettings::default();
        settings.storage_path = path.to_string_lossy().into_owned();
        AppState {
            settings: Mutex::new(settings),
            ..Default::default()
        }
    }

    #[test]
    fn import_file_creates_note_with_filename_as_title() {
        let dir = TempDir::new().unwrap();
        let file_path = dir.path().join("shopping-list.txt");
        std::fs::write(&file_path, "milk\neggs").unwrap();
        let notes_path = dir.path().join("notes.json");
        let state = test_state_with_storage(&notes_path);

        let note = import_file(file_path.to_string_lossy().into_owned(), State::from(&state))
            .unwrap();

        assert_eq!(note.title, "shopping-list");
        assert_eq!(note.content, "milk\neggs");
        assert!(!note.private);

        let stored = load_notes(&notes_path.to_string_lossy());
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].id, note.id);
    }

    #[test]
    fn import_file_updates_last_import_export_dir() {
        let dir = TempDir::new().unwrap();
        let file_path = dir.path().join("data.csv");
        std::fs::write(&file_path, "a,b\n1,2").unwrap();
        let notes_path = dir.path().join("notes.json");
        let state = test_state_with_storage(&notes_path);

        import_file(file_path.to_string_lossy().into_owned(), State::from(&state)).unwrap();

        let last_dir = state.settings.lock().unwrap().last_import_export_dir.clone();
        assert_eq!(last_dir, Some(dir.path().to_string_lossy().into_owned()));
    }

    #[test]
    fn import_file_rejects_non_utf8_bytes() {
        let dir = TempDir::new().unwrap();
        let file_path = dir.path().join("binary.txt");
        std::fs::write(&file_path, [0xFF, 0xFE, 0x00, 0xFF]).unwrap();
        let notes_path = dir.path().join("notes.json");
        let state = test_state_with_storage(&notes_path);

        let err = import_file(file_path.to_string_lossy().into_owned(), State::from(&state))
            .unwrap_err();

        assert_eq!(err, "Could not read file as text");
    }
```

> Note: `State::from(&state)` requires `tauri::State` to be constructible from a plain reference in a unit-test context. Tauri's `State<'r, T>` is `#[derive(Deref)]` over `&'r T` and implements `From<&'r T>` specifically to support this kind of test — this is the same mechanism the existing `settings_roundtrip` style tests would need if they called a command directly. If `State::from(&state)` doesn't compile against the installed `tauri` version, the fallback is to test the underlying logic without the `State` wrapper: extract the body of `import_file` into a private `fn import_file_impl(path: String, settings: &Mutex<AppSettings>) -> Result<Note, String>` and have the `#[tauri::command]` wrapper call `import_file_impl(path, &settings.settings)`, then test `import_file_impl` directly. Try `State::from(&state)` first since it keeps the command a single function; fall back only if `cargo test` reports it doesn't exist.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test --lib import_file`
Expected: FAIL to compile — `cannot find function import_file`.

- [ ] **Step 3: Implement `import_file`**

Add it right after `rename_note`:

```rust
#[tauri::command]
fn import_file(path: String, settings: State<AppState>) -> Result<Note, String> {
    let file_path = PathBuf::from(&path);
    let bytes = fs::read(&file_path).map_err(|e| format!("Failed to read file: {}", e))?;
    let content = String::from_utf8(bytes).map_err(|_| "Could not read file as text".to_string())?;
    let title = file_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .to_string();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    let note = Note {
        id: uuid::Uuid::new_v4().to_string(),
        title,
        content,
        created_at: now,
        private: false,
    };

    let mut s = settings.settings.lock().map_err(|e| e.to_string())?;
    let mut notes = load_notes(&s.storage_path);
    notes.push(note.clone());
    store_notes(&s.storage_path, &notes)?;

    if let Some(parent) = file_path.parent() {
        s.last_import_export_dir = Some(parent.to_string_lossy().into_owned());
        save_settings(&s);
    }

    Ok(note)
}
```

- [ ] **Step 4: Register the command**

In `invoke_handler(tauri::generate_handler![...])`, add `import_file,` after `set_active_note_context,`. (The macOS file-association path in Task 7 calls the `import_file` Rust function directly, not through `invoke`, but it still needs to be in the handler list for the File-menu's `invoke`-free direct call in Task 5 to type-check the same way every other command does — keeping it registered is also required for consistency/future direct frontend use.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --lib`
Expected: PASS — all tests green, including the 3 new `import_file` tests.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: import_file command (file to new Note)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Import UI wiring — File menu handler

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `import_file(path: String, settings: State<AppState>) -> Result<Note, String>` (Task 4), menu item id `"import_file"` (already created in Task 2 Step 4)
- Produces: on successful import, emits Tauri event `"note-imported"` with a `Note` payload

- [ ] **Step 1: Add the `import_file` menu handler**

Inside `app.on_menu_event(|app, event| { ... })`, add this block next to the `export_note` block from Task 2:

```rust
                if event.id() == "import_file" {
                    let state = app.state::<AppState>();
                    let last_dir = state.settings.lock().unwrap().last_import_export_dir.clone();

                    let mut dialog = app
                        .dialog()
                        .file()
                        .add_filter("Text files", &["csv", "md", "txt", "json"]);
                    if let Some(dir) = &last_dir {
                        dialog = dialog.set_directory(dir);
                    }
                    if let Some(picked) = dialog.blocking_pick_file() {
                        if let Ok(path) = picked.into_path() {
                            match import_file(path.to_string_lossy().into_owned(), app.state::<AppState>()) {
                                Ok(note) => {
                                    let _ = app.emit("note-imported", note);
                                }
                                Err(e) => {
                                    let _ = app.dialog().message(e).title("Import Failed").blocking_show();
                                }
                            }
                        }
                    }
                }
```

- [ ] **Step 2: Build and manually verify**

Run: `cd src-tauri && cargo check`
Expected: builds cleanly. As in Task 2 Step 6, if `add_filter`/`blocking_pick_file` don't match the installed API, adjust to the compiler-suggested method names.

Then `npm run tauri:dev`, use File → Import…, pick a `.txt` file with plain text in it, confirm the dialog closes without error (the frontend doesn't react yet — that's Task 6).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: Import… menu item and native open dialog

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Frontend Import wiring

**Files:**
- Modify: `src/App.tsx`
- Modify: `tests/globals.d.ts` (no change needed — `__TEST_EMIT__` already accepts arbitrary payloads)
- Test: Create `tests/import.spec.ts`

**Interfaces:**
- Consumes: event `"note-imported"` (payload: `Note`) (Task 5)
- Produces: nothing new consumed by later tasks — this is a leaf.

- [ ] **Step 1: Write the failing Playwright test**

Create `tests/import.spec.ts`:

```typescript
import { test, expect, Page } from "@playwright/test";

async function load(page: Page) {
  await page.addInitScript({ path: "tests/mocks/tauri-ipc.js" });
  await page.goto("/");
  await page.waitForSelector('[data-testid="tab"]');
}

test.beforeEach(async ({ page }) => {
  await load(page);
});

test("Import adds the emitted note as a new active tab", async ({ page }) => {
  const before = await page.locator('[data-testid="tab"]').count();

  await page.evaluate(() =>
    window.__TEST_EMIT__("note-imported", {
      id: "imported-1",
      title: "shopping-list",
      content: "milk\neggs",
      created_at: Date.now(),
      private: false,
    })
  );

  await expect(page.locator('[data-testid="tab"]')).toHaveCount(before + 1);
  const activeTab = page.locator('[data-testid="tab"][data-active="true"] [data-testid="tab-title"]');
  await expect(activeTab).toHaveText("shopping-list");
  await expect(page.locator('[data-testid="editor"]')).toHaveValue("milk\neggs");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/import.spec.ts`
Expected: FAIL — tab count doesn't change (nothing listens for `"note-imported"` yet).

- [ ] **Step 3: Wire the frontend**

In `src/App.tsx`, add the listener near the other `useTauriEvent` calls (e.g. right after the `"export-note-to"` listener added in Task 3):

```typescript
  useTauriEvent<Note>("note-imported", (note) => {
    setNotes((prev) => [...prev, note]);
    setShowScreens(false);
    setActiveId(note.id);
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/import.spec.ts`
Expected: PASS.

- [ ] **Step 5: Run the full test suite**

Run: `npm run test`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx tests/import.spec.ts
git commit -m "feat: wire Import to note-imported event

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: macOS file association (double-click / Open With)

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/src/lib.rs`
- Modify: `docs/devlog/batch-2026-07-03-import-export/` (add a `README.md` recording the manual verification, per project devlog convention)

**Interfaces:**
- Consumes: `import_file(path: String, settings: State<AppState>) -> Result<Note, String>` (Task 4)
- Produces: nothing consumed elsewhere — this is the final task.

This feature cannot be exercised by Playwright (no packaged app, no Finder, no `RunEvent`) — it's a manual verification task, same as the CSP screenshot-thumbnail fix in the previous devlog batch.

- [ ] **Step 1: Declare the file associations**

In `src-tauri/tauri.conf.json`, inside `"bundle": { ... }`, add:

```json
    "fileAssociations": [
      {
        "ext": ["csv", "md", "txt", "json"],
        "name": "Text Document",
        "description": "Text file openable by ScratchPad",
        "role": "Editor"
      }
    ],
```

(Add it as a sibling of the existing `"icon"` and `"windows"` keys inside `"bundle"`.)

- [ ] **Step 2: Handle `RunEvent::Opened`**

In `src-tauri/src/lib.rs`, the `run()` function currently ends with:

```rust
        .invoke_handler(tauri::generate_handler![
            ...
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Change the final two lines to split `.build()` from `.run()` so the run-event loop can inspect `RunEvent::Opened`:

```rust
        .invoke_handler(tauri::generate_handler![
            ...
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Opened { urls } = event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        let state = app_handle.state::<AppState>();
                        match import_file(path.to_string_lossy().into_owned(), state) {
                            Ok(note) => {
                                let _ = app_handle.emit("note-imported", note);
                            }
                            Err(e) => {
                                let _ = app_handle
                                    .dialog()
                                    .message(e)
                                    .title("Import Failed")
                                    .blocking_show();
                            }
                        }
                    }
                }
            }
        });
}
```

(Leave the `...` — the `invoke_handler` list itself is unchanged from Task 4/5.)

- [ ] **Step 3: Build**

Run: `cd src-tauri && cargo check`
Expected: builds cleanly. If `tauri::RunEvent::Opened`'s field isn't named `urls`, or `Url::to_file_path()` isn't available, the compiler error will point at the mismatch — check `cargo doc -p tauri --open` for the exact `RunEvent` variant shape in the installed version and adjust.

- [ ] **Step 4: Manual verification (packaged app required — Finder file association only applies to a bundled `.app`, not `tauri dev`)**

```bash
npm run tauri:build
open src-tauri/target/release/bundle/dmg/ScratchPad_*.dmg
```

Install/replace the app in `/Applications` (or drag it there from the DMG). Then:
1. Create a plain text file, e.g. `echo "test import" > ~/Desktop/test.txt`.
2. Right-click it in Finder → Open With → ScratchPad (or, once it's the default handler, just double-click it).
3. Confirm ScratchPad opens (or comes to front if already running) with a new tab titled "test" containing "test import".
4. Repeat with a `.csv`, `.md`, and `.json` file to confirm all four extensions are registered.

If macOS doesn't offer ScratchPad in "Open With" immediately, run `killall Finder` and `lsregister -f /Applications/ScratchPad.app` (or just relaunch Finder) — Launch Services caches file associations and sometimes needs a nudge after a fresh build.

- [ ] **Step 5: Record the manual verification result**

Create `docs/devlog/batch-2026-07-03-import-export/README.md`:

```markdown
# Batch 2026-07-03: Import / Export files

Implements the two approved todo.md features: Export a note to a file, and
Import any `.csv`/`.md`/`.txt`/`.json` file as a new note (menu + macOS file
association). Design: `features-plan.md`. Implementation plan: `plan.md`.

## Automated coverage
- Rust: `export_note`, `import_file` (success, UTF-8 rejection, settings
  `last_import_export_dir` persistence) — `cd src-tauri && cargo test --lib`
- Playwright: `tests/export.spec.ts`, `tests/import.spec.ts` — `npm run test`

## Manual verification (macOS file association)
<Fill in after running Task 7 Step 4: date tested, macOS version, which of
the 4 extensions were confirmed working via Finder double-click / Open With,
and any Launch Services cache gotchas hit.>
```

- [ ] **Step 6: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/src/lib.rs docs/devlog/batch-2026-07-03-import-export/README.md
git commit -m "feat: macOS file association for csv/md/txt/json

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
