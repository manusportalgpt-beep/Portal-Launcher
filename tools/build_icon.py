from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = root / "src-tauri" / "icons" / "icon.png"
out = root / "src-tauri" / "icons" / "icon.ico"
image = Image.open(source).convert("RGBA")
image.save(out, format="ICO", sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)])
print(out)
