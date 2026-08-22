# Taskbar Icon Verification

`src-tauri/tauri.conf.json` packages `icons/32x32.png`, `icons/128x128.png`, `icons/128x128@2x.png`, `icons/icon.icns`, and `icons/icon.ico`. The Windows NSIS installer and uninstaller are also explicitly configured to use `icons/icon.ico`.

The current `tools/icon_source.png`, shell icon, favicon and `src-tauri/icons/icon.png` share the same SHA-256 source image hash. The generated native PNG, ICO and ICNS files have distinct expected hashes because they contain native size/format encodings generated from that source.

Windows taskbar icons are embedded in the compiled executable. Therefore the running desktop process cannot replace its own taskbar resource merely because repository assets change. A new Tauri/Windows build must be installed after this icon update; then the old process needs to exit. If Windows still shows an earlier embedded resource after that replacement, its local icon cache may need to refresh.

Audit note, 2026-08-22: the current `src-tauri/icons/icon.png` is the square Portal mark, while the affected desktop and title-bar surfaces still resolve through `icons/icon.ico` and the compiled Windows executable. `tools/reframe_icons.py` now preserves the full 512px square master instead of cropping for an obsolete circular source, and regenerated `icon.ico` plus all Windows PNG sizes. Bundle version `1.0.2` forces a newly installed NSIS/MSI artifact to replace the prior executable resource. Existing desktop links must be recreated from the fresh installation if Explorer keeps their old `IconLocation` cache.
