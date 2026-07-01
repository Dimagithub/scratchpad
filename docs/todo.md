#approved


#done
##UI polish: help in View menu, floating copy button, better preview icon
Moved Quick Help to View menu (was a toolbar button; ? key still works). Copy-note is now a modern floating button in the note's top-right corner with a "Copied" tooltip. Markdown preview toggle icon changed from an eye to a split-view icon. (v1.0.10)

##Quick help
"?" toolbar button (or the ? key) opens a dismissible Quick Help modal covering basic usage and keyboard shortcuts (Notes, Find, Screenshots, Markdown, Privacy, Window & View). (v1.0.9)

##Screenshot sound + button feedback
Short click sound on capture activation (📷/⌃⌘4); Copy button shows "Copied ✓"; Copy/Delete buttons depress on press. (v1.0.9)

##BUG: screenshot thumbnails not showing
Packaged-app CSP had no `img-src`, so `data:` image URLs were blocked (worked in dev since Vite doesn't enforce the Tauri CSP). Added `img-src 'self' data:`. Copy still worked because it reads the file, not the data URL.

##Open screenshot full-size
Click a gallery thumbnail to open the PNG in the macOS default viewer (Preview.app) via `open_screenshot`.

##Delete all screenshots
"Delete all" button in the Screenshots gallery header (`delete_all_screenshots` clears `~/ScratchPad/screenshots/`).

##Quick copy button for text notes
Toolbar 📋 button copies the active note's content to the clipboard (navigator.clipboard with a `pbcopy` Rust fallback).

##Tab orientation Top/Left/Right
View → Tab Position submenu toggles tabs between top bar, left sidebar, and right sidebar; persisted in settings.json.

##Markdown validate + preview
Validate button lints common markdown issues (unclosed fences, broken links/images, malformed tables, heading jumps). Preview toggle shows a side-by-side live render (marked + DOMPurify sanitize). Copy-source available from both editor and preview.

##Screenshots
Take screenshots (📷 button or ⌃⌘4 global hotkey) via native macOS `screencapture -i`; the PNG is copied to the clipboard and saved to `~/ScratchPad/screenshots/`. A dedicated Screenshots tab shows a thumbnail gallery with per-image Copy and Delete. (v1.0.8)

##Tab renaming
Already supported via double-click on the tab title (inline edit, Enter to confirm, Esc to cancel). Added a "Double-click to rename" tooltip for discoverability. (v1.0.7)

##BUG: opacity not working on macOS
Window wasn't natively transparent — `transparent: true` on macOS requires the `macos-private-api` feature. Enabled `app.macOSPrivateApi` + the `macos-private-api` Cargo feature. (v1.0.7)

##Keyword search
Simple keyword search: case-sensitive by default with an Aa toggle for insensitive; scrolls to and selects each match; Next/Previous (↑/↓, Enter/Shift+Enter); shows match count. ⌘F/Ctrl+F or 🔍 button. (shipped in v1.0.4)

##Check for Updates every 5 minutes
Check for updates every 5 min and show New Release x.x.x button and allow to click it or ignore it and continue working. (shipped in v1.0.3)
