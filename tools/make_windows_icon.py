"""Build the high-quality multi-resolution Windows icon used by Portal Launcher.

The launcher source icon stays untouched. This script creates the ICO with the
sizes Windows Explorer needs for taskbar, shortcut and desktop rendering.
"""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src-tauri" / "icons" / "icon.png"
TARGET = ROOT / "src-tauri" / "icons" / "icon.ico"
SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def main() -> None:
    source = Image.open(SOURCE).convert("RGBA")
    if source.width != source.height:
        edge = min(source.width, source.height)
        left = (source.width - edge) // 2
        top = (source.height - edge) // 2
        source = source.crop((left, top, left + edge, top + edge))
    source.save(TARGET, format="ICO", sizes=SIZES)
    print(f"Created {TARGET} from {SOURCE} with {len(SIZES)} Windows icon sizes.")


if __name__ == "__main__":
    main()
