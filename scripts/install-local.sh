#!/bin/bash
# Installs the latest local DMG build to /Applications and re-signs it with
# the stable "ScratchPad Local Dev" cert so Screen Recording (TCC) permission
# survives rebuilds — ad-hoc signing gets a new identity every build.
set -euo pipefail

DMG=$(ls -t src-tauri/target/release/bundle/dmg/*.dmg | head -1)
echo "Installing $DMG"

MOUNT_POINT=$(hdiutil attach "$DMG" -nobrowse | grep -o '/Volumes/.*')
trap 'hdiutil detach "$MOUNT_POINT" -quiet' EXIT

rm -rf /Applications/ScratchPad.app
cp -R "$MOUNT_POINT/ScratchPad.app" /Applications/

codesign --force --deep --sign "ScratchPad Local Dev" /Applications/ScratchPad.app
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /Applications/ScratchPad.app
killall Finder || true

echo "Installed and signed /Applications/ScratchPad.app"
