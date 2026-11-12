"""Read-only Stage 2 image checks specified in CODEX-TASK.md."""
import argparse
import json
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
inspect = runpy.run_path(str(ROOT / "out/1-base/verify_stage1.py"))["inspect"]


def inspect_key(path, base):
    result = inspect(path)
    bbox = result["character_bbox_exclusive"]
    base_bbox = base["character_bbox_exclusive"]
    reference_height = base_bbox[3] - base_bbox[1]
    height = bbox[3] - bbox[1] if bbox else 0
    deviation = (height / reference_height - 1) * 100
    result["reference_height_px"] = reference_height
    result["character_height_px"] = height
    result["height_deviation_percent"] = round(deviation, 3)
    result["checks"]["height_within_2_5_percent_of_approved_base"] = abs(deviation) <= 2.5
    result["passed"] = all(result["checks"].values())
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("paths", nargs="*", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    paths = args.paths or sorted(Path(__file__).parent.glob("W[0-9][0-9].png"))
    base = inspect(ROOT / "refs/walk-base.png")
    results = [inspect_key(path, base) for path in paths]
    serialized = json.dumps(results, ensure_ascii=False, indent=2)
    if args.report:
        args.report.write_text(serialized + "\n", encoding="utf-8")
    print(serialized)
    raise SystemExit(0 if results and all(result["passed"] for result in results) else 1)
