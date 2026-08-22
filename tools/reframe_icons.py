from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "tools" / "icon_source.png"


def frame_icon(image: Image.Image, size: int) -> Image.Image:
    # The master asset is already a final square composition. Older code
    # assumed a 1024px circular source and cropped it, which can regenerate a
    # wrong ICO from the current 512px Portal mark. Preserve the entire source
    # when making every Windows resolution.
    return image.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    source = Image.open(SOURCE).convert("RGBA")
    canonical = frame_icon(source, 1024)
    icon_dir = ROOT / "src-tauri" / "icons"
    canonical.save(icon_dir / "icon.png")
    frame_icon(source, 128).save(icon_dir / "128x128.png")
    frame_icon(source, 256).save(icon_dir / "128x128@2x.png")
    frame_icon(source, 32).save(icon_dir / "32x32.png")
    canonical.save(icon_dir / "icon.ico", sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)])
    frame_icon(source, 512).save(ROOT / "public" / "launcher-icon.png")
    frame_icon(source, 128).save(ROOT / "public" / "favicon.png")
    frame_icon(source, 128).save(ROOT / "public" / "favicon.ico", sizes=[(128, 128), (64, 64), (32, 32), (16, 16)])


if __name__ == "__main__":
    main()
