from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "tools" / "icon_source.png"


def frame_icon(image: Image.Image, size: int) -> Image.Image:
    # Original mark has roughly 9% empty edge padding. Crop it and return a
    # slightly protected 96%-fill canvas so Windows small-size rendering keeps
    # the circle clean rather than looking like a tiny dot.
    padding = max(2, round(size * 0.022))
    inner = size - padding * 2
    crop = image.crop((90, 90, 934, 934)).resize((inner, inner), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(crop, ((size - crop.width) // 2, (size - crop.height) // 2))
    return canvas


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
