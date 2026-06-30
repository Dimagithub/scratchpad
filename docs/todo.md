
#approved


#done
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
