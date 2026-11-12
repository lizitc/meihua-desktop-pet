"""Build only the Stage 3 review images; never modify source frame PNGs."""
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageSequence

DIRECTORY = Path(__file__).resolve().parent
ROOT = DIRECTORY.parents[1]
FRAMES = [f"W{index:02d}" for index in range(16)]


def source_path(index):
    folder = DIRECTORY if index % 2 else ROOT / "out/2-keys"
    return folder / f"W{index:02d}.png"


def white_preview(image):
    """Composite green to white in previews only; neutralize green edge samples."""
    red, green, blue = image.convert("RGB").split()
    excess = ImageChops.subtract(green, ImageChops.lighter(red, blue))
    background = excess.point(lambda value: 255 if value >= 60 else 0)
    neutral_edges = Image.merge(
        "RGB", (ImageChops.add(red, excess), green, ImageChops.add(blue, excess))
    )
    return Image.composite(Image.new("RGB", image.size, "white"), neutral_edges, background)


def main():
    paths = [source_path(index) for index in range(16)]
    originals = [Image.open(path).convert("RGB") for path in paths]
    assert all(image.size == (1024, 1536) for image in originals)
    previews = [white_preview(image) for image in originals]

    tile_width, tile_height, header_height = 384, 576, 40
    row_height = tile_height + header_height
    sheet = Image.new("RGB", (tile_width * 8, row_height * 2), "white")
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 24)
    except OSError:
        font = ImageFont.load_default(size=24)
    for index, (frame, preview) in enumerate(zip(FRAMES, previews)):
        x, y = index % 8 * tile_width, index // 8 * row_height
        draw.text((x + tile_width // 2, y + 20), frame, fill="#444452", font=font, anchor="mm")
        sheet.paste(
            preview.resize((tile_width, tile_height), Image.Resampling.LANCZOS),
            (x, y + header_height),
        )
    sheet.save(DIRECTORY / "contact-sheet.png")

    gif_size = (512, 768)
    frames = [preview.resize(gif_size, Image.Resampling.LANCZOS) for preview in previews]
    training = Image.new("RGB", (128 * len(frames), 192), "white")
    for index, frame in enumerate(frames):
        training.paste(frame.resize((128, 192), Image.Resampling.LANCZOS), (index * 128, 0))
    trained = training.quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    palette = Image.new("P", (1, 1))
    palette.putpalette([255, 255, 255] + trained.getpalette()[:255 * 3])
    indexed = []
    for frame in frames:
        quantized = frame.quantize(palette=palette, dither=Image.Dither.NONE)
        # Pillow's palette lookup may map exact white into a near-white bucket.
        # Preserve exact white from the RGB preview using reserved palette index 0.
        difference = ImageChops.difference(frame, Image.new("RGB", frame.size, "white"))
        red, green, blue = difference.split()
        difference_max = ImageChops.lighter(ImageChops.lighter(red, green), blue)
        exact_white = difference_max.point(lambda value: 255 if value == 0 else 0)
        quantized.paste(0, mask=exact_white)
        indexed.append(quantized)
    # GIF stores whole centiseconds. Round accumulated 1/14-second frame boundaries:
    # 70/80ms intervals, total 1140ms (ideal 1142.857ms), nominal 14fps.
    durations = [(round((index + 1) * 100 / 14) - round(index * 100 / 14)) * 10 for index in range(16)]
    indexed[0].save(
        DIRECTORY / "preview.gif", save_all=True, append_images=indexed[1:],
        duration=durations, loop=0, disposal=2, optimize=False,
    )
    with Image.open(DIRECTORY / "preview.gif") as animation:
        actual_durations = [frame.info["duration"] for frame in ImageSequence.Iterator(animation)]
        white_corners = all(
            frame.convert("RGB").getpixel((0, 0)) == (255, 255, 255)
            for frame in ImageSequence.Iterator(animation)
        )
        info = {
            "frame_order": FRAMES,
            "source_paths": [path.relative_to(ROOT).as_posix() for path in paths],
            "frame_count": animation.n_frames,
            "size": list(animation.size),
            "nominal_fps": 14,
            "durations_ms": actual_durations,
            "loop_duration_ms": sum(actual_durations),
            "average_fps": animation.n_frames * 1000 / sum(actual_durations),
            "ideal_loop_duration_ms": 16 * 1000 / 14,
            "loop": animation.info.get("loop"),
            "background": "white",
            "all_decoded_frame_corners_pure_white": white_corners,
            "source_pngs_modified": False,
            "alignment": "original canvas, no per-frame translation or registration",
            "contact_sheet_size": list(sheet.size),
            "contact_sheet_rows": [FRAMES[:8], FRAMES[8:]],
        }
    assert info["frame_count"] == 16
    assert info["durations_ms"] == durations
    assert info["loop_duration_ms"] == 1140
    assert info["loop"] == 0
    assert white_corners
    assert all(frame.getpixel((0, 0)) == (255, 255, 255) for frame in frames)
    (DIRECTORY / "review-checks.json").write_text(json.dumps(info, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(info, indent=2))


if __name__ == "__main__":
    main()
