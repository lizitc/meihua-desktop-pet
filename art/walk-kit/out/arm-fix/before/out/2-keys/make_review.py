"""Build the review sheet/GIF requested by Stage 2; leave key PNGs intact."""
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageSequence

DIRECTORY = Path(__file__).resolve().parent
KEYS = [f"W{index:02d}" for index in range(0, 16, 2)]


def white_preview(image):
    """Replace chroma green with white, removing green tint from edge samples."""
    red, green, blue = image.convert("RGB").split()
    excess = ImageChops.subtract(green, ImageChops.lighter(red, blue))
    background = excess.point(lambda value: 255 if value >= 60 else 0)
    neutral_edges = Image.merge(
        "RGB", (ImageChops.add(red, excess), green, ImageChops.add(blue, excess))
    )
    return Image.composite(Image.new("RGB", image.size, "white"), neutral_edges, background)


def main():
    originals = [Image.open(DIRECTORY / f"{key}.png").convert("RGB") for key in KEYS]
    assert all(image.size == (1024, 1536) for image in originals)
    previews = [white_preview(image) for image in originals]

    tile_width, tile_height, header_height = 384, 576, 40
    sheet = Image.new("RGB", (tile_width * len(KEYS), tile_height + header_height), "white")
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 24)
    except OSError:
        font = ImageFont.load_default(size=24)
    for index, (key, preview) in enumerate(zip(KEYS, previews)):
        x = index * tile_width
        draw.text((x + tile_width // 2, 20), key, fill="#444452", font=font, anchor="mm")
        sheet.paste(preview.resize((tile_width, tile_height), Image.Resampling.LANCZOS), (x, header_height))
    sheet.save(DIRECTORY / "contact-sheet.png")

    gif_size = (512, 768)
    frames = [preview.resize(gif_size, Image.Resampling.LANCZOS) for preview in previews]
    training = Image.new("RGB", (128 * len(frames), 192), "white")
    for index, frame in enumerate(frames):
        training.paste(frame.resize((128, 192), Image.Resampling.LANCZOS), (index * 128, 0))
    palette = training.quantize(colors=256, method=Image.Quantize.MEDIANCUT)
    indexed = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in frames]
    # GIF stores centiseconds: alternate 120/130ms for exactly 1000ms per 8-frame loop.
    durations = [120, 130] * 4
    indexed[0].save(
        DIRECTORY / "preview.gif", save_all=True, append_images=indexed[1:],
        duration=durations, loop=0, disposal=2, optimize=False,
    )
    with Image.open(DIRECTORY / "preview.gif") as animation:
        actual_durations = [frame.info["duration"] for frame in ImageSequence.Iterator(animation)]
        info = {
            "frame_order": KEYS,
            "frame_count": animation.n_frames,
            "size": list(animation.size),
            "durations_ms": actual_durations,
            "loop_duration_ms": sum(actual_durations),
            "average_fps": animation.n_frames * 1000 / sum(actual_durations),
            "loop": animation.info.get("loop"),
            "background": "white",
            "source_pngs_modified": False,
            "contact_sheet_size": list(sheet.size),
        }
    assert info["frame_count"] == 8
    assert info["average_fps"] == 8
    assert info["loop"] == 0
    (DIRECTORY / "review-checks.json").write_text(json.dumps(info, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(info, indent=2))


if __name__ == "__main__":
    main()
