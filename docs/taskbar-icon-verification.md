# Taskbar Icon Verification

`src-tauri/tauri.conf.json` packages `icons/32x32.png`, `icons/128x128.png`, `icons/128x128@2x.png`, `icons/icon.icns`, and `icons/icon.ico`. The Windows NSIS installer and uninstaller are also explicitly configured to use `icons/icon.ico`.

The current `tools/icon_source.png`, shell icon, favicon and `src-tauri/icons/icon.png` share the same SHA-256 source image hash. The generated native PNG, ICO and ICNS files have distinct expected hashes because they contain native size/format encodings generated from that source.

Windows taskbar icons are embedded in the compiled executable. Therefore the running desktop process cannot replace its own taskbar resource merely because repository assets change. A new Tauri/Windows build must be installed after this icon update; then the old process needs to exit. If Windows still shows an earlier embedded resource after that replacement, its local icon cache may need to refresh.
