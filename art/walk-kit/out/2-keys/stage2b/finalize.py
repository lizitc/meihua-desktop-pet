"""Recheck Stage 2b outputs and verify approved/before files by SHA256."""
import hashlib
import json
import runpy
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
KEYS = ROOT / "out/2-keys"
corrections = runpy.run_path(str(HERE / "verify_corrections.py"))
common = runpy.run_path(str(KEYS / "verify_stage2.py"))


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest().upper()


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    ledger = json.loads((HERE / "generation.json").read_text(encoding="utf-8"))
    base = common["inspect"](ROOT / "refs/walk-base.png")
    basic = [common["inspect_key"](path, base) for path in sorted(KEYS.glob("W[0-9][0-9].png"))]
    write_json(KEYS / "checks.json", basic)
    correction_checks = []
    sources_match = []
    backups_match = []
    for record in ledger["selected"]:
        frame = record["frame"]
        current = KEYS / f"{frame}.png"
        measured = corrections["correction_metrics"](current, frame)
        correction_checks.append(measured)
        write_json(HERE / f"{frame}-final-checks.json", measured)
        write_json(KEYS / f"{frame}-checks.json", [next(item for item in basic if Path(item["file"]).stem == frame)])
        write_json(KEYS / f"{frame}-generation.json", record)
        sources_match.append({"frame": frame, "matches_selected_generation": digest(current) == digest(record["source"])})
        previous_record = json.loads((HERE / "before" / f"{frame}-generation.json").read_text(encoding="utf-8-sig"))
        backups_match.append({"frame": frame, "v1_matches_previous_generation": digest(KEYS / "attempts" / f"{frame}-v1.png") == digest(previous_record["source"])})
    protected = json.loads((HERE / "protected-before.json").read_text(encoding="utf-8-sig"))
    protected_checks = [{"path": item["Path"], "unchanged": digest(item["Path"]) == item["Hash"]} for item in protected]
    preservation = {
        "protected_files": protected_checks,
        "all_protected_files_unchanged": all(item["unchanged"] for item in protected_checks),
        "selected_pngs_match_tool_outputs": sources_match,
        "all_selected_pngs_match_tool_outputs": all(item["matches_selected_generation"] for item in sources_match),
        "v1_backups": backups_match,
        "all_v1_backups_match_previous_sources": all(item["v1_matches_previous_generation"] for item in backups_match),
    }
    write_json(HERE / "preservation-checks.json", preservation)
    write_json(HERE / "checks.json", correction_checks)
    summary = {
        "basic_checks_passed": sum(item["passed"] for item in basic),
        "basic_checks_total": len(basic),
        "correction_checks_passed": sum(item["passed"] for item in correction_checks),
        "correction_checks_total": len(correction_checks),
        "measurements": [{"frame": item["stage2b"]["frame"], "basic_passed": item["basic_passed"], "local_correction_passed": item["passed"], "raw_floor_relative_bob_px": item["stage2b"]["raw_floor_relative_bob_px"], "border_green_fraction": item["border_green_fraction"], "front_clearance_px": item["stage2b"]["front_clearance_from_rear_px"], "contact_spacing_ratio_to_W00": item["stage2b"].get("contact_spacing_ratio_to_W00")} for item in correction_checks],
        "protected_files_unchanged": preservation["all_protected_files_unchanged"],
        "sources_and_backups_match": preservation["all_selected_pngs_match_tool_outputs"] and preservation["all_v1_backups_match_previous_sources"],
    }
    write_json(HERE / "summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    assert preservation["all_protected_files_unchanged"]
    assert summary["sources_and_backups_match"]
