"""Read-only Pillow checks required by CODEX-TASK.md, Stage 1."""
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops


def inspect(path):
    with Image.open(path) as source:
        rgba = source.convert("RGBA")
        rgb = rgba.convert("RGB")
        width, height = rgb.size
        red, green, blue = rgb.split()
        green_excess = ImageChops.subtract(green, ImageChops.lighter(red, blue))
        character = green_excess.point(lambda value: 255 if value < 60 else 0)
        bbox = character.getbbox()
        hip_pixels = list(character.crop((0, 900, width, min(1001, height))).tobytes())
        hip_count = sum(value != 0 for value in hip_pixels)
        hip_center = (
            sum(index % width for index, value in enumerate(hip_pixels) if value)
            / hip_count if hip_count else None
        )
        pixels = rgb.load()
        border_count = border_green = 0
        for y in range(height):
            columns = range(width) if y < 20 or y >= height - 20 else (*range(20), *range(width - 20, width))
            for x in columns:
                r, g, b = pixels[x, y]
                border_count += 1
                border_green += r <= 8 and g >= 247 and b <= 8
        border_ratio = border_green / border_count
        top = bbox[1] if bbox else None
        bottom = bbox[3] - 1 if bbox else None
        checks = {
            "canvas_1024x1536": rgb.size == (1024, 1536),
            "opaque": rgba.getchannel("A").getextrema() == (255, 255),
            "border_green_at_least_99_percent": border_ratio >= 0.99,
            "top_between_40_and_110": top is not None and 40 <= top <= 110,
            "bottom_between_1468_and_1492": bottom is not None and 1468 <= bottom <= 1492,
            "hip_center_within_512_plus_or_minus_60": hip_center is not None and abs(hip_center - 512) <= 60,
        }
        return {
            "file": str(path),
            "size": [width, height],
            "character_bbox_exclusive": bbox,
            "top_row": top,
            "bottom_row": bottom,
            "hip_center_x": round(hip_center, 2) if hip_center is not None else None,
            "border_green_fraction": round(border_ratio, 6),
            "checks": checks,
            "passed": all(checks.values()),
        }


if __name__ == "__main__":
    paths = [Path(value) for value in sys.argv[1:]] or sorted(Path(__file__).parent.glob("base-*.png"))
    results = [inspect(path) for path in paths]
    print(json.dumps(results, ensure_ascii=False, indent=2))
    sys.exit(0 if results and all(item["passed"] for item in results) else 1)
