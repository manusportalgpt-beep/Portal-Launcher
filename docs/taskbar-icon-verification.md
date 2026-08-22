# Taskbar Icon Verification

`src-tauri/tauri.conf.json` packages `icons/32x32.png`, `icons/128x128.png`, `icons/128x128@2x.png`, `icons/icon.icns`, and `icons/icon.ico`. The Windows NSIS installer and uninstaller are also explicitly configured to use `icons/icon.ico`.

The current `tools/icon_source.png`, shell icon, favicon and `src-tauri/icons/icon.png` share the same SHA-256 source image hash. The generated native PNG, ICO and ICNS files have distinct expected hashes because they contain native size/format encodings generated from that source.

Windows taskbar icons are embedded in the compiled executable. Therefore the running desktop process cannot replace its own taskbar resource merely because repository assets change. A new Tauri/Windows build must be installed after this icon update; then the old process needs to exit. If Windows still shows an earlier embedded resource after that replacement, its local icon cache may need to refresh.

Audit note, 2026-08-22: the current `src-tauri/icons/icon.png` is the square Portal mark, while the affected desktop and title-bar surfaces still resolve through `icons/icon.ico` and the compiled Windows executable. `tools/reframe_icons.py` now preserves the full 512px square master instead of cropping for an obsolete circular source, and regenerated `icon.ico` plus all Windows PNG sizes. Bundle version `1.0.3` forces a newly installed NSIS/MSI artifact to replace the prior executable resource. On the first startup of that artifact, Portal Launcher refreshes only an existing `Portal Launcher.lnk` desktop link to point to a new versioned local `shortcut-icons/portal-launcher-1.0.3.ico`; instance shortcuts and user-created links are not modified. Explorer may still need to be restarted if it holds a stale icon cache.

Source: [Tauri v2 App Icons](https://v2.tauri.app/develop/icons/) specifies that Windows `icon.ico` should include the standard 16, 24, 32, 48, 64 and 256px layers, and that icon assets are bundled into the built desktop application. [Tauri v2 Windows Installer](https://v2.tauri.app/distribute/windows-installer/) describes NSIS setup artifacts as the Windows installation path for the new executable resource.
