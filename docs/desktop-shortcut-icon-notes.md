# Desktop Shortcut Icon Update

Portal Launcher’s Windows desktop shortcut receives its app image from the `.ico` embedded in the compiled executable and NSIS installer. A shortcut that already exists on the desktop continues to display the image cached for the previously installed executable until that executable has been replaced by a new installer build.

The native resources now regenerate from `tools/icon_reference_spiral.svg`, which has a transparent square canvas and a larger central circular portal mark. This source is intentionally sized for the 16–48 px Windows shortcut range; the mark occupies roughly 82% of the canvas while retaining transparent padding.

## Updating an existing desktop icon

1. Build the current `main` branch through GitHub Actions and run the new Windows installer.
2. Close every running Portal Launcher process before installation so Windows can replace the old executable.
3. If Explorer still draws the earlier icon, delete only the existing Portal Launcher desktop shortcut and create/reinstall it again. The new shortcut will read the new executable’s bundled `icon.ico`.
4. If Windows continues to render an older cached image, restart Explorer or sign out/in; this is Windows’ local icon cache, not a repository asset mismatch.

The launcher’s own source, shell icon, favicon, `icon.ico`, `icon.icns`, and Tauri PNG sizes are generated together from the same vector source, so a fresh build does not mix old and new assets.
