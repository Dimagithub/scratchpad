# Features Plan — Tab Orientation + Markdown Tools

Batch: 2026-07-01 (appended to the screenshots-notes devlog)

Two non-trivial features built on top of the existing screenshots/copy-note
work in the working tree.

- **Feature #4** — Tab orientation toggle: Top / Left / Right (persisted).
- **Feature #6** — Markdown: validate + side-by-side preview + copy source.

---

## Feature #4 — Tab orientation toggle

### Goal
Let the user place the tab strip at the Top (current, default), as a Left
vertical sidebar, or as a Right vertical sidebar. Persisted in settings and
driven from the native View menu.

### Backend (src-tauri/src/lib.rs)
- Add `tab_position: String` to `AppSettings` with
  `#[serde(default = "default_tab_position")]` returning `"top"`. Add to
  `Default`. Persists via `save_settings`/`settings.json`, returned by
  `get_settings`.
- New `default_tab_position()` free function.
- In the View submenu add a **Tab Position** submenu with three
  `CheckMenuItem`s: `tabpos_top` / `tabpos_left` / `tabpos_right`
  ("Top"/"Left"/"Right"), checked from the initial setting.
- In `on_menu_event`, handle the three ids: update `settings.tab_position`,
  `save_settings`, set the three checks (only selected checked), and
  `app.emit("settings-changed", json!({ "tab_position": <value> }))`.
- Unit tests: `tab_position` defaults to `"top"` from empty JSON; roundtrips
  a non-default value.

### Frontend (src/App.tsx)
- New state `tabPosition: "top" | "left" | "right"`, initialized from
  `get_settings` (extend typing, default `"top"`).
- Extend the `settings-changed` handler to update `tabPosition` when
  `payload.tab_position` is present.
- Restructure layout by orientation:
  - `top`: root column `[tabBar][searchBar][editor]` (unchanged).
  - `left`: root **row** `[sidebar][main column: searchBar + editor]`.
  - `right`: root **row** `[main column][sidebar]` (sidebar on the right).
- Sidebar: fixed width ~184px; toolbar buttons in a wrapped row at the top;
  tabs stacked vertically full-width (title + close ×), vertical scroll on
  overflow. All existing `data-testid`s preserved in every orientation.
- Add `data-tabpos={tabPosition}` to `app-root`.
- `getStyles(theme, opacity)` extended to produce sidebar vs top-bar variants,
  consistent with dark/light theming + opacity.
- Screenshots special tab and everything else works in all three orientations.

### Design choice
The toolbar (search, copy, screenshot, privacy, add, plus the new markdown
buttons) is rendered by a single `renderToolbarButtons()` helper so it is
identical in all orientations. The tab list is rendered by `renderTabs()`.
Top orientation lays these out horizontally in `styles.tabBar`; left/right
stack them in `styles.sidebar`. This avoids duplicating JSX and keeps every
`data-testid` intact.

---

## Feature #6 — Markdown validate + preview + copy source

Available only for a non-private, active **text** note (not while viewing
Screenshots).

### (a) Validate
- New module `src/markdownLint.ts` exporting
  `lintMarkdown(text): { line: number; message: string }[]`. Detects:
  - Unclosed fenced code block (odd number of ``` fence lines).
  - Broken link/image: a `](` on a line with no closing `)` after it.
  - Malformed table: a header row followed by a separator line that is not
    composed of `-`/`:`/`|`/space; or body rows whose column count differs
    from the header. Conservative.
  - Heading-level jump: an ATX heading whose level is >1 greater than the
    previous heading level.
- Toolbar button `data-testid="md-validate"`. On click run
  `lintMarkdown(content)` and show a dismissible banner
  `data-testid="md-lint-results"`: either a list of items
  (`data-testid="md-lint-item"`, text `line N: message`) or a single OK
  (`data-testid="md-lint-ok"`). Dismiss/close control included.

### (b) Preview (side-by-side split)
- Deps: `marked`, `dompurify` (+ `@types/dompurify` if types missing).
- Toolbar toggle `data-testid="md-preview-toggle"` (👁). When on (`showPreview`)
  the editor area becomes a horizontal split: LEFT editable textarea, RIGHT
  read-only rendered pane `data-testid="md-preview"` showing
  `DOMPurify.sanitize(marked.parse(content))` via `dangerouslySetInnerHTML`,
  live-updating, independently scrollable. Coexists with all three tab
  orientations. Always sanitized.
- Readable markdown styling (headings, code, lists, links, tables) themed.

### (c) Copy source from both views
- Existing 📋 copy-note copies raw source — kept.
- New button inside the preview pane `data-testid="md-preview-copy"` copies the
  RAW markdown `content` (reusing `copyNote`).

### Visibility rules
`md-validate`, `md-preview-toggle` shown only when `!showScreens && activeNote
&& !activeNote.private`. `md-preview` / `md-preview-copy` render only when
`showPreview` and those same conditions hold.

---

## Test plan (Playwright)

- `tab_position:"top"` added to mock `currentSettings`.
- New `tab-position.spec.ts`: emit `settings-changed {tab_position:"left"}`,
  assert `app-root[data-tabpos=left]` and tabs still render; same for `right`
  and back to `top`.
- New `markdown.spec.ts`:
  - Validate: type known-bad markdown, click `md-validate`, assert
    `md-lint-item` entries; type clean markdown, assert `md-lint-ok`.
  - Preview: click `md-preview-toggle`, assert `md-preview` visible; type
    `# Hello`, assert preview contains `<h1>Hello`; assert `md-preview-copy`
    present and clickable.
  - Assert preview/validate buttons hidden while viewing Screenshots and for
    private notes.
- Rust unit tests for `tab_position` in the existing `#[cfg(test)] mod`.

## Not automatically testable
- Native menu items (Tab Position submenu, checks) — only in the built .app.
- Real clipboard writes (copy source) — mocked in tests.
- Packaged-app CSP behavior.

---

## Results (2026-07-01)

All verification commands green.

### Files changed
- `src-tauri/src/lib.rs` — `tab_position` field + default fn; Tab Position
  submenu (tabpos_top/left/right) with initial checks; menu-event handler that
  persists + emits `settings-changed {tab_position}`; updated + new unit tests.
- `src/App.tsx` — `tabPosition`/`showPreview`/`lintResults` state; get_settings
  + settings-changed wiring; `data-tabpos` on app-root; layout restructured
  into reusable `tabsList` / `toolbar` / `mainColumn` composed per orientation
  (top row-bar vs left/right sidebar); markdown Validate button + dismissible
  lint banner; preview toggle with side-by-side sanitized pane (marked +
  DOMPurify) and in-pane copy-source button; `getStyles` extended (sidebar,
  vertical tabs, split editor, preview, lint) + `previewCss` for rendered
  markdown descendants.
- `src/markdownLint.ts` — new `lintMarkdown()` (unclosed fence, broken
  link/image, malformed table, heading-level jump).
- `tests/mocks/tauri-ipc.js` — `tab_position:"top"` in currentSettings + reset.
- `tests/tab-position.spec.ts`, `tests/markdown.spec.ts` — new specs.
- `package.json` / lockfile — added `marked`, `dompurify` (dompurify ships its
  own types; the conflicting `@types/dompurify` stub was removed).

### Design chosen
- Feature #4: a single `toolbar` + `tabsList` are rendered identically in all
  orientations and only re-arranged by the root (`column` for top with a
  horizontal tab bar; `row` for left/right with a fixed 184px vertical
  sidebar). Every existing `data-testid` is preserved. Orientation is exposed
  via `data-tabpos` on `app-root`.
- Feature #6: preview reuses the existing `editor` flex container as a two-pane
  horizontal split (editable textarea | sanitized read-only pane), so it works
  unchanged inside all three orientations. Preview HTML is always
  `DOMPurify.sanitize(marked.parse(content))`. Markdown tooling is gated on
  `!showScreens && activeNote && !activeNote.private`.

### Final passing output
```
tsc: 0 errors

test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out

44 passed (playwright)
```

### Not automatically testable (manual / packaged-app only)
- Native "Tab Position" submenu items and their check-state syncing — only
  exist in the built `.app`'s menu bar.
- Settings persistence to `~/ScratchPad/settings.json` across launches.
- Real clipboard writes for copy-source (mocked as `copy_text` in tests).
- Packaged-app CSP behavior for rendered content.
