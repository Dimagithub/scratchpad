# ScratchPad

A lightweight, tabbed notepad desktop app built with Tauri. Quick and secure notes stored locally — no data leaves your computer.

## Download

[Download for macOS (Apple Silicon)](https://github.com/Dimagithub/scratchpad/releases/latest/download/ScratchPad_0.1.0_aarch64.dmg)

Intel Mac and Windows builds coming soon.

## Features

- **Tabbed notepads** — each tab is an independent text editor
- **Cmd+Shift+S** — global shortcut to bring ScratchPad to the front
- **Close minimizes to dock** — no accidental quit
- **Auto-save** while typing
- **Double-click tabs** to rename them
- **System tray** — left-click to show, right-click for menu
- **Auto-update** — checks GitHub releases for new versions

## Build from source

```bash
npm install
npm run tauri:build
```

The DMG will be at `src-tauri/target/release/bundle/dmg/ScratchPad_*.dmg`.

## Tech

- [Tauri 2](https://v2.tauri.app/)
- [React 19](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/)

## License

MIT
