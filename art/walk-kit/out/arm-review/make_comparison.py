"""Read-only arm-motion review; crops are diagnostics, not replacement artwork."""
import hashlib
import json
import runpy
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = Path(__file__).resolve().parent
white = runpy.run_path(str(ROOT / "out/3-inbetweens/make_review.py"))["white_preview"]
FRAMES = [f"W{i:02d}" for i in range(16)]


def frame_path(i):
    return ROOT / ("out/3-inbetweens" if i % 2 else "out/2-keys") / f"W{i:02d}.png"


def main():
    sources = [frame_path(i) for i in range(16)]
    hashes = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sources}
    (DIRECTORY / "source-hashes-before.json").write_text(json.dumps(hashes, indent=2) + "\n", encoding="utf-8")
    font = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 22)
    for start in (0, 8):
        cell_w, cell_h = 640, 350
        sheet = Image.new("RGB", (4 * cell_w, 2 * cell_h), "white")
        draw = ImageDraw.Draw(sheet)
        for i in range(start, start + 8):
            x, y = ((i - start) % 4 * cell_w, (i - start) // 4 * cell_h)
            draw.text((x + 16, y + 5), f"W{i:02d}   ART                         GUIDE", fill="#333333", font=font)
            art = white(Image.open(frame_path(i))).crop((200, 450, 880, 1030))
            guide = Image.open(ROOT / "guides" / f"guide-W{i:02d}.png").convert("RGB").crop((340, 500, 740, 980))
            sheet.paste(art.resize((366, 312), Image.Resampling.LANCZOS), (x, y + 35))
            sheet.paste(guide.resize((260, 312), Image.Resampling.LANCZOS), (x + 375, y + 35))
        sheet.save(DIRECTORY / f"arms-W{start:02d}-W{start + 7:02d}.png")
    animation = []
    for i in range(16):
        frame = Image.new("RGB", (640, 350), "white")
        draw = ImageDraw.Draw(frame)
        draw.text((16, 5), f"W{i:02d}   ART                         GUIDE", fill="#333333", font=font)
        art = white(Image.open(frame_path(i))).crop((200, 450, 880, 1030))
        guide = Image.open(ROOT / "guides" / f"guide-W{i:02d}.png").convert("RGB").crop((340, 500, 740, 980))
        frame.paste(art.resize((366, 312), Image.Resampling.LANCZOS), (0, 35))
        frame.paste(guide.resize((260, 312), Image.Resampling.LANCZOS), (375, 35))
        animation.append(frame)
    animation[0].save(
        DIRECTORY / "arms-comparison-4fps.gif", save_all=True, append_images=animation[1:],
        duration=250, loop=0, disposal=2,
    )
    unchanged = all(hashlib.sha256(path.read_bytes()).hexdigest() == hashes[str(path.relative_to(ROOT))] for path in sources)
    assert unchanged
    (DIRECTORY / "preservation-checks.json").write_text(
        json.dumps({"original_frames_checked": 16, "all_unchanged": unchanged}, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"source_images": len(sources), "originals_modified": False, "sheets": ["arms-W00-W07.png", "arms-W08-W15.png"]}))


if __name__ == "__main__":
    main()
