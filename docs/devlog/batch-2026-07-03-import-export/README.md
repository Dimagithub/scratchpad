# Batch 2026-07-03: Import / Export files

Implements the two approved todo.md features: Export a note to a file, and
Import any `.csv`/`.md`/`.txt`/`.json` file as a new note (menu + macOS file
association). Design: `features-plan.md`. Implementation plan: `plan.md`.

## Design decision: exporting a private note

The final review flagged that Export ignores the privacy toggle — a private
note's 🔒 masking only affects the on-screen display (`content` is rendered
as `•` characters), not the underlying content, so File → Export writes the
note's real, unmasked text to disk. Decided intentionally: Export is an
explicit, deliberate user action, so exporting a locked note's real content
on request is expected behavior, not a leak. No code change made for this.

## Automated coverage
- Rust: `export_note`, `import_file` (success, UTF-8 rejection, settings
  `last_import_export_dir` persistence) — `cd src-tauri && cargo test --lib`
  (18/18 passing)
- Playwright: `tests/export.spec.ts`, `tests/import.spec.ts` — `npm run test`

## Manual verification (macOS file association)

Date: 2026-07-03. macOS 26.4 (build 25E246), Apple Silicon (arm64).

Built a real packaged app with `npm run tauri:build` (produces
`src-tauri/target/release/bundle/macos/ScratchPad.app` and
`src-tauri/target/release/bundle/dmg/ScratchPad_1.0.10_aarch64.dmg`).
Installed to `/Applications/ScratchPad.app` and re-signed with the stable
local "ScratchPad Local Dev" cert (see local-signing notes), then registered
with Launch Services (`lsregister -f /Applications/ScratchPad.app`) and
restarted Finder.

`Info.plist` was inspected directly and confirmed correct:

```
CFBundleDocumentTypes:
  CFBundleTypeName: Text Document
  CFBundleTypeExtensions: csv, md, txt, json
  LSItemContentTypes: public.plain-text, public.json
  CFBundleTypeRole: Editor
```

Verification was driven via the `open -a ScratchPad <file>` CLI, which
invokes the same Launch Services API (`LSOpenURLsWithRole`) that Finder's
"Open With" menu and double-click use — this exercises the identical
`RunEvent::Opened` code path end to end, including cold launch (app not
running) and warm launch (app already running, new tab added to the
existing window). This environment has no interactive GUI/mouse access to
literally right-click in Finder, so the CLI-level Launch Services trigger
plus visual screenshot confirmation was used as the closest faithful
substitute; a human should still spot-check the Finder "Open With" context
menu once, though the underlying mechanism is verified.

Results, all 4 extensions confirmed:

| Extension | File | Cold/warm launch | Result |
|---|---|---|---|
| `.txt` | `scratchpad-test.txt` (`test import`) | Cold (app not running) | New tab "scratchpad-test" opened with content "test import", confirmed via screenshot |
| `.csv` | `scratchpad-test.csv` (`a,b,c`) | Warm (app already open) | New note created with content `a,b,c\n`, confirmed via notes.json |
| `.md` | `scratchpad-test.md` (`# heading`) | Warm | New note created with content `# heading\n`, confirmed via notes.json |
| `.json` | `scratchpad-test.json` (`{"a":1}`) | Warm | New note created with content `{"a":1}\n`, confirmed via screenshot (frontmost tab) and notes.json |

Each import appended a note to the store the running app was using
(`~/ScratchPad/notes.json`) with the file's basename as the title and exact
file content preserved — matching `import_file`'s existing behavior (Task
4/5), now reachable via the OS file-open path in addition to the File menu.
Test notes and test files were deleted after verification; the user's 2
pre-existing real notes were left untouched.

Launch Services gotchas hit: none beyond the expected cache nudge
(`lsregister -f` + `killall Finder`) called out in the task brief — the
newly-built app was picked up without further prompting.

One unrelated observation, not a regression from this task: `settings.json`
on disk referenced a `storage_path` under a stale `/var/folders/.../T/...`
temp directory (no longer present on disk, likely a leftover from an
earlier Playwright run). After this run the app settled on the default
`~/ScratchPad/notes.json` path, which is where the user's real notes
already lived — worth a human glance but out of scope for this task.
