# UI polish (v1.0.10)

Follow-up tweaks from user feedback after v1.0.9:

- **Quick Help moved to the native View menu** (`View → Quick Help`, emits `show-help`).
  Removed the `?` toolbar button; the `?` key shortcut still opens it.
- **Copy-note button** moved out of the toolbar to a **floating modern button in the
  note editor's top-right corner** (Feather "copy" SVG), with a transient **"Copied"**
  tooltip on success. In split-preview mode the "Copy source" button gains the same
  "Copied ✓" feedback.
- **Markdown preview toggle icon** changed from the eye (👁) to a **split-view SVG**
  (two panes) — clearer for side-by-side preview.

Tests: help.spec rewritten to open via the `show-help` event (View-menu path) + `?` key;
added a note-copy "Copied" tooltip assertion. tsc clean, cargo 9/9, playwright 51/51.
