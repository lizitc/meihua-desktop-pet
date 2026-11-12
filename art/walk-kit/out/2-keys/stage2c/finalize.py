"""Run the provided foot checker on all eight keys and verify preservation."""
import hashlib
import json
import runpy
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
KEYS = ROOT / "out/2-keys"
TARGETED = ("W04", "W06", "W10", "W14")


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest().upper()


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    ledger = json.loads((HERE / "generation.json").read_text(encoding="utf-8"))
    relative_keys = [str(Path("out/2-keys") / f"W{index:02d}.png") for index in range(0, 16, 2)]
    command = [sys.executable, "-W", "ignore::DeprecationWarning", "tools/feet_check.py", *relative_keys]
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    if result.stderr:
        print(result.stderr, file=sys.stderr)
    (HERE / "feet-final.jsonl").write_text(result.stdout, encoding="utf-8")
    final = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
    write_json(HERE / "feet-final.json", final)
    official = {item["frame"]: item for item in final}

    common = runpy.run_path(str(KEYS / "verify_stage2.py"))
    base = common["inspect"](ROOT / "refs/walk-base.png")
    basic = [common["inspect_key"](ROOT / relative, base) for relative in relative_keys]
    write_json(KEYS / "checks.json", basic)
    write_json(HERE / "basic-checks-information-only.json", basic)

    selected_checks, backup_checks = [], []
    for record in ledger["selected"]:
        frame = record["frame"]
        current = KEYS / f"{frame}.png"
        selected_checks.append({
            "frame": frame,
            "visual_correct": record["visual_correct"],
            "matches_selected_generation": digest(current) == digest(record["source"]),
        })
        previous = json.loads((HERE / "before" / f"{frame}-generation.json").read_text(encoding="utf-8-sig"))
        backup_checks.append({"frame": frame, "v2_backup_matches_previous_source": digest(KEYS / "attempts" / f"{frame}-v2.png") == digest(previous["source"])})
        write_json(KEYS / f"{frame}-generation.json", record)
        write_json(KEYS / f"{frame}-checks.json", [next(item for item in basic if Path(item["file"]).stem == frame)])
        write_json(HERE / f"{frame}-final-feet-check.json", official[frame])
        write_json(HERE / f"{frame}-selected.json", record)

    protected = json.loads((HERE / "protected-before.json").read_text(encoding="utf-8-sig"))
    protected_checks = [{"path": item["Path"], "unchanged": digest(item["Path"]) == item["Hash"]} for item in protected]
    preservation = {
        "protected_files": protected_checks,
        "all_protected_files_unchanged": all(item["unchanged"] for item in protected_checks),
        "selected_images": selected_checks,
        "all_selected_images_match_tool_sources": all(item["matches_selected_generation"] for item in selected_checks),
        "v2_backups": backup_checks,
        "all_v2_backups_match_previous_sources": all(item["v2_backup_matches_previous_source"] for item in backup_checks),
    }
    write_json(HERE / "preservation-checks.json", preservation)
    targeted = [official[frame] for frame in TARGETED]
    summary = {
        "stage": "2c",
        "final_key_count": len(final),
        "targeted_frames_passed": sum(item.get("pass") is True for item in targeted),
        "targeted_frame_count": len(TARGETED),
        "checker_exit_code": result.returncode,
        "total_generations": ledger["total_generations"],
        "retry_counts": ledger["retry_counts"],
        "final_targeted_measurements": targeted,
        "preservation_verified": preservation["all_protected_files_unchanged"] and preservation["all_selected_images_match_tool_sources"] and preservation["all_v2_backups_match_previous_sources"],
        "old_height_and_green_checks": "information only for Stage 2c; not used to spend generation attempts",
    }
    write_json(HERE / "summary.json", summary)
    print(result.stdout, end="")
    print(json.dumps({"targeted_passed": summary["targeted_frames_passed"], "targeted_total": len(TARGETED), "preservation_verified": summary["preservation_verified"]}, indent=2))
    assert len(final) == 8
    assert result.returncode == 0
    assert all(item.get("pass") is True and item["score"] == 0 for item in targeted)
    assert all(item["visual_correct"] for item in selected_checks)
    assert summary["preservation_verified"]
