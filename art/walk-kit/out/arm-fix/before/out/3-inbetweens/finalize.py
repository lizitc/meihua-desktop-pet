"""Verify Stage 3 files and write its report; never edit original artwork."""
import hashlib
import json
import runpy
import subprocess
import sys
from pathlib import Path

DIRECTORY = Path(__file__).resolve().parent
ROOT = DIRECTORY.parents[1]


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest().upper()


def write_json(name, value):
    (DIRECTORY / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    ledger = json.loads((DIRECTORY / "generation.json").read_text(encoding="utf-8"))
    frames = [f"W{index:02d}" for index in range(16)]
    paths = [
        Path("out/3-inbetweens" if index % 2 else "out/2-keys") / f"{frame}.png"
        for index, frame in enumerate(frames)
    ]
    command = [sys.executable, "-W", "ignore::DeprecationWarning", "tools/feet_check.py", *map(str, paths)]
    measured = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, check=True)
    raw_output = measured.stdout
    (DIRECTORY / "feet-final.jsonl").write_text(raw_output, encoding="utf-8")
    feet = [json.loads(line) for line in raw_output.splitlines() if line.strip()]
    write_json("feet-final.json", feet)
    assert [result["frame"] for result in feet] == frames
    targeted = [result for result in feet if "pass" in result]
    odd = [result for index, result in enumerate(feet) if index % 2]
    assert len(targeted) == 12 and len(odd) == 8
    assert all(result["pass"] and result["score"] == 0 for result in targeted)

    before = json.loads((DIRECTORY / "protected-before.json").read_text(encoding="utf-8-sig"))
    changed = [
        item["Path"] for item in before
        if not Path(item["Path"]).is_file() or sha256(item["Path"]) != item["Hash"].upper()
    ]
    preservation = {
        "protected_file_count": len(before), "all_unchanged": not changed, "changed": changed,
        "scope": "Initial snapshot: top-level out/2-keys files, refs, guides, processed, tools",
        "approved_key_hashes": {
            frame: sha256(ROOT / "out/2-keys" / f"{frame}.png") for frame in frames[::2]
        },
    }
    write_json("preservation-checks.json", preservation)
    assert not changed, changed

    namespace = runpy.run_path(str(ROOT / "out/2-keys/verify_stage2.py"))
    inspect_key, inspect_image = namespace["inspect_key"], namespace["inspect"]
    base = inspect_image(ROOT / "refs/walk-base.png")
    basic_final = [inspect_key(ROOT / path, base) for path in paths]
    basic_attempts, attempt_hashes = [], []
    for run in ledger["runs"]:
        frame, attempt = run["frame"], run["attempt"]
        path = DIRECTORY / "attempts" / f"{frame}-try-{attempt}.png"
        assert path.is_file() and sha256(path) == sha256(run["source"])
        assert len(run["references"]) == 5
        assert "CHARACTER (keep exactly" in run["prompt"]
        assert "TECHNICAL (must follow):" in run["prompt"]
        assert (DIRECTORY / "attempts" / f"{frame}-try-{attempt}.json").is_file()
        basic_attempts.append(inspect_key(path, base))
        attempt_hashes.append({"frame": frame, "attempt": attempt, "sha256": sha256(path), "identical_to_imagegen_source": True})
    for item in ledger["frames"]:
        selected = next(run for run in ledger["runs"] if run["frame"] == item["frame"] and run["attempt"] == item["selected_attempt"])
        assert selected["feet_check"]["pass"] and selected["visual_correct"]
        assert sha256(ROOT / item["output"]) == sha256(selected["source"])
        assert 1 <= item["attempt_count"] <= 6
    write_json("basic-checks-information-only.json", {
        "note": "Body height/bob and border-green are informational only in Stage 3. Original drawings are not translated or recolored.",
        "final_frames": basic_final, "all_attempts": basic_attempts,
    })
    write_json("generation-source-checks.json", {
        "all_final_pngs_identical_to_selected_imagegen_source": True,
        "all_attempt_pngs_identical_to_imagegen_source": True, "attempt_hashes": attempt_hashes,
    })
    required = (
        "canvas_1024x1536", "opaque", "hip_center_within_512_plus_or_minus_60",
        "height_within_2_5_percent_of_approved_base",
    )
    assert all(all(result["checks"][name] for name in required) for result in basic_final)
    review = json.loads((DIRECTORY / "review-checks.json").read_text(encoding="utf-8"))
    assert review["frame_count"] == 16 and review["loop"] == 0
    assert review["all_decoded_frame_corners_pure_white"]
    assert review["contact_sheet_rows"] == [frames[:8], frames[8:]]
    summary = {
        "stage": 3, "odd_frames": 8, "odd_frames_passed": len(odd),
        "all_targeted_frames_passed": len(targeted), "approved_keys_changed": 0,
        "protected_file_count": len(before), "imagegen_calls": ledger["total_generations"],
        "retries": ledger["total_retries"], "all_final_pngs_original_generated_pixels": True,
        "attempts": [{name: item[name] for name in ("frame", "attempt_count", "retries", "selected_attempt")} for item in ledger["frames"]],
        "review": review,
    }
    arm_review_path = ROOT / "out/arm-review/findings.json"
    arm_review = json.loads(arm_review_path.read_text(encoding="utf-8")) if arm_review_path.exists() else None
    if arm_review:
        summary["arm_review"] = {"status": arm_review["status"], "report": "out/arm-review/REPORT.md"}
        summary["overall_review_status"] = "arm_correction_required" if arm_review["status"] == "failed" else "pending_visual_review"
    write_json("summary.json", summary)

    report = [
        "# Stage 3 完成报告", "",
        "已生成 W01、W03、W05、W07、W09、W11、W13、W15 共 8 张中间帧，全部通过原版 tools/feet_check.py，均为 pass=true、score=0；同时人工检查了腿部身份、遮挡关系、两条腿、两只完整袜脚和两只手。",
        f"全程使用内置 image_gen.imagegen，共 {ledger['total_generations']} 次生成、{ledger['total_retries']} 次重试，按 W03、W11、W05、W13、W01、W09、W07、W15 顺序生成。每次均使用任务规定顺序的 5 张参考图并展开 CHARACTER、TECH 固定块。",
        "", "## 保存文件", "",
        "- out/3-inbetweens/W01.png、W03.png、W05.png、W07.png、W09.png、W11.png、W13.png、W15.png：8 张 1024×1536、不透明绿底原始生成图。",
        "- out/3-inbetweens/contact-sheet.png：3072×1232，W00–W07 在第一行，W08–W15 在第二行，每行 8 张，绿底转白底。",
        "- out/3-inbetweens/preview.gif：16 帧，512×768，名义 14 fps，无限循环，绿底转纯白。GIF 以 10ms 存储时间，采用 14 个 70ms 和 2 个 80ms 帧间隔，循环 1140ms，实际均值约 14.035 fps。",
        "- out/3-inbetweens/attempts/Wxx-try-N.png 及同名 JSON：所有尝试、逐次测量、视觉判定、完整提示词和有序参考路径。",
        "- generation.json / prompts.json：生成记录与提示词计划；feet-final.jsonl / feet-final.json：最终 16 帧的原版工具输出。",
        "- preservation-checks.json / generation-source-checks.json / basic-checks-information-only.json / review-checks.json / summary.json：保留性、原图来源、尺寸与预览检查。",
        "- make_review.py / finalize.py：可重跑的预览和只读核验脚本。",
        "", "## 重试与选择", "",
    ]
    for item in ledger["frames"]:
        runs = [run for run in ledger["runs"] if run["frame"] == item["frame"]]
        scores = " → ".join(str(run["feet_check"]["score"]) for run in runs)
        report.append(f"- {item['frame']}：生成 {item['attempt_count']} 次，重试 {item['retries']} 次；采用第 {item['selected_attempt']} 次；score：{scores}。")
    report.extend([
        "",
        "W07 第 1 次除了数值超界，手臂和腿部遮挡还偏向 W00，近远侧身份不可靠，因此拒绝。最终选择均同时满足测量和腿部身份检查，没有采用“6 次后最低分”的例外。",
        "", "## 最终脚位", "",
        "- W01：近侧前支撑脚跟 554；W03：近侧平脚支撑脚尖 579；W05：近侧支撑脚尖 478。",
        "- W07：近侧后支撑脚尖 377，接触宽度 53；远侧前摆动脚尖 756，离地 44px。",
        "- W09：远侧前支撑脚跟 583；W11：远侧平脚支撑脚尖 652；W13：远侧支撑脚尖 528。",
        "- W15：远侧后支撑脚尖 425，接触宽度 54；近侧前摆动脚尖 719，离地 43px。",
        "", "## 核验与保留", "",
        f"- 初始快照中的 {len(before)} 个受保护文件 SHA-256 全部未变，包括 8 张已批准关键帧、其顶层审查文件和 refs / guides / processed / tools。未重画或覆盖任何关键帧，也未改动 feet_check.py 或测量范围。",
        "- 所有最终中间帧与所选 imagegen 原图的 SHA-256 相同；所有尝试也保留了生成的原始像素。未用程序变形、移动、拼接或修补角色。程序只创建任务要求的总览/GIF，并在这两个审查文件中把绿底转白。",
        "- 最终 16 张原图尺寸、不透明度、腰裙中心和相对 approved base 的轮廓高度 ±2.5% 检查通过。身体高度/底行和边框纯绿检查按 Stage 3 说明仅作信息记录，未据此重试。预览保持原画布坐标，没有逐帧对齐头部或脚底。",
        "- 最终 16 帧中，8 张中间帧及 4 张 Stage 2c 有范围约束的关键帧，共 12 张通过工具目标。W00、W02、W08、W12 在该工具中没有目标范围，原样输出测量，不把它们虚报成 pass=true。",
        "", "## 仍不完全满意的细节", "",
        "- W01、W09 的后摆脚更接近后一个关键帧的弯曲/抬起状态，较理想的严格半程位置偏高、偏蜷；W05 的远侧摆动脚也偏蜷、偏高。它们的支撑脚均已通过数值目标，腿部身份正确，但不能据此宣称所有关节都精确居中。",
        "- 手臂、裙褶、发梢和尾巴是逐张重画，仍有细小轮廓与阴影差异；工具的脚位通过并不等于这些部位已达到像素级连续。请结合 16 帧 GIF 评估运动观感。",
        "- W07、W15 的前脚均未落地，最低点相对各自支撑脚地面为 44px、43px，已在 14–45px 要求内。原图的高度变化留给任务所述 build 调整。",
        "", "## 原版 feet_check.py 最终 16 帧输出", "",
        "命令：python -W ignore::DeprecationWarning tools/feet_check.py [依序传入下列 16 个原图路径]；退出码 0。只抑制 Pillow 弃用提示，测量逻辑未改动。",
        "", "~" * 3 + "jsonl", raw_output.rstrip(), "~" * 3, "",
        "本阶段到此结束，未执行可选 Stage 4。", "",
    ])
    if arm_review and arm_review["status"] == "failed":
        report[0] = "# Stage 3 脚位结果（手臂复查未通过）"
        report[1:1] = [
            "",
            "> 后续逐帧复查确认手臂冻结、跳变及 Passing 锚点偏离参考：W05→W06、W10→W11 不连续，W04/W12 未收回体侧。此前整体视觉验收不足；下面的脚位通过结果仍有效，但不能代表完整动画已通过。详见 [手臂复查报告](../arm-review/REPORT.md) 及 [对照慢放](../arm-review/arms-comparison-4fps.gif)。当前状态：手臂待修正。",
        ]
    (DIRECTORY / "REPORT.md").write_text("\n".join(report), encoding="utf-8")
    print(json.dumps({
        "odd_frames_passed": len(odd), "targeted_frames_passed": len(targeted),
        "protected_files_unchanged": len(before), "imagegen_calls": ledger["total_generations"],
        "retries": ledger["total_retries"], "final_sizes_opaque_center_and_scale": True,
        "report": str(DIRECTORY / "REPORT.md"),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
