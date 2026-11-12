"""Read-only checks for Stage 2b, including floor-relative bob and foot lift.

Bob uses raw green-mask silhouette height, not the external head registration.
The user will remeasure registered results; this is an explicit local proxy.
"""
import argparse
import json
import runpy
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[3]
common = runpy.run_path(str(ROOT / "out/2-keys/verify_stage2.py"))
inspect_key = common["inspect_key"]
inspect = common["inspect"]
TARGETS = {"W02": 7, "W06": -12, "W08": 0, "W14": -12}


def contact_spacing(path):
    with Image.open(path) as image:
        red, green, blue = image.convert("RGB").split()
        excess = ImageChops.subtract(green, ImageChops.lighter(red, blue))
        mask = excess.point(lambda value: 255 if value < 60 else 0)
        bottom = mask.getbbox()[3] - 1
        centers = []
        for left in (0, 512):
            band = mask.crop((left, bottom - 12, left + 512, bottom + 1))
            pixels = band.tobytes()
            count = sum(value != 0 for value in pixels)
            center = left + sum(index % 512 for index, value in enumerate(pixels) if value) / count if count else None
            centers.append(center)
        return {
            "contact_band_y": [bottom - 12, bottom],
            "left_contact_center_x": round(centers[0], 2) if centers[0] is not None else None,
            "right_contact_center_x": round(centers[1], 2) if centers[1] is not None else None,
            "spacing_px": round(centers[1] - centers[0], 2) if all(value is not None for value in centers) else None,
        }


def correction_metrics(path, frame):
    result = inspect_key(path, inspect(ROOT / "refs/walk-base.png"))
    reference = inspect(ROOT / "out/2-keys/W00.png")
    reference_height = reference["character_bbox_exclusive"][3] - reference["character_bbox_exclusive"][1]
    bob = reference_height - result["character_height_px"]
    with Image.open(path) as image:
        red, green, blue = image.convert("RGB").split()
        excess = ImageChops.subtract(green, ImageChops.lighter(red, blue))
        mask = excess.point(lambda value: 255 if value < 60 else 0)
        left_box = mask.crop((0, 1300, 512, 1536)).getbbox()
        right_box = mask.crop((512, 1300, 1024, 1536)).getbbox()
        left_bottom = 1300 + left_box[3] - 1 if left_box else None
        right_bottom = 1300 + right_box[3] - 1 if right_box else None
    additional = {"floor_relative_head_bob_within_4px_of_target": abs(bob - TARGETS[frame]) <= 4}
    clearance = left_bottom - right_bottom if left_bottom is not None and right_bottom is not None else None
    if frame in ("W06", "W14"):
        additional["front_foot_clearance_approximately_50_to_70px"] = clearance is not None and 45 <= clearance <= 75
    result["stage2b"] = {
        "frame": frame,
        "bob_metric": "W00_raw_silhouette_height_minus_frame_height_after_floor_alignment",
        "external_head_registration_applied": False,
        "target_bob_px_positive_down": TARGETS[frame],
        "raw_floor_relative_bob_px": bob,
        "raw_top_difference_from_W00_px": result["top_row"] - reference["top_row"],
        "rear_left_foot_bottom_y": left_bottom,
        "front_right_foot_bottom_y": right_bottom,
        "front_clearance_from_rear_px": clearance,
        "up_frame_requested_clearance_px": [50, 70] if frame in ("W06", "W14") else None,
        "up_frame_check_tolerance_px": 5 if frame in ("W06", "W14") else None,
        "checks": additional,
    }
    if frame == "W08":
        contact = contact_spacing(path)
        reference_contact = contact_spacing(ROOT / "out/2-keys/W00.png")
        ratio = contact["spacing_px"] / reference_contact["spacing_px"] if contact["spacing_px"] is not None else None
        result["stage2b"]["contact_spacing"] = contact
        result["stage2b"]["W00_contact_spacing"] = reference_contact
        result["stage2b"]["contact_spacing_ratio_to_W00"] = round(ratio, 4) if ratio is not None else None
        additional["contact_spacing_within_10_percent_of_W00"] = ratio is not None and abs(ratio - 1) <= 0.10
    result["basic_passed"] = result["passed"]
    result["passed"] = result["basic_passed"] and all(additional.values())
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=Path)
    parser.add_argument("--frame", required=True, choices=TARGETS)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    result = correction_metrics(args.path, args.frame)
    serialized = json.dumps(result, ensure_ascii=False, indent=2)
    if args.report:
        args.report.write_text(serialized + "\n", encoding="utf-8")
    print(serialized)
    raise SystemExit(0 if result["passed"] else 1)
