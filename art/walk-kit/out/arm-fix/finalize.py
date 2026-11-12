"""Verify and optionally promote the complete arm repair.
Usage: python out/arm-fix/finalize.py --promote
       python out/arm-fix/finalize.py --verify-only
Original artwork is never edited here; accepted imagegen PNGs are copied byte-for-byte.
"""
import argparse,hashlib,json,math,re,runpy,shutil,subprocess,sys
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont,ImageSequence

D=Path(__file__).resolve().parent
ROOT=D.parents[1]
FRAMES=[f"W{i:02d}" for i in range(16)]
KEY_NOTES={
"W00":"收窄近侧后摆与远侧前摆，建立轻柔后摆极值。",
"W02":"双臂由后摆逐步回到体侧，不再冻结旧接触姿势。",
"W04":"双臂垂落贴近身体，重建 Passing 中立锚点。",
"W06":"近侧小幅前摆；远侧向后、部分进入躯干遮挡，去掉原先横跨围裙的手臂。",
"W08":"建立近侧前摆极值；远侧臂后摆到躯干/围裙右缘之后，仅露出自然的手指边缘。",
"W10":"双臂从前摆平缓回到中立；远侧手逐步从遮挡中露出。",
"W12":"双臂贴近体侧，与 W04 的中立锚点一致。",
"W14":"近侧轻微后摆、远侧轻微前摆，为 W15→W00 回环衔接。"
}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def write(name,value):
    (D/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")


def canonical(frame):
    return ROOT/("out/3-inbetweens" if int(frame[1:])%2 else "out/2-keys")/(frame+".png")


def feet(paths):
    result=subprocess.run([sys.executable,"-W","ignore::DeprecationWarning","tools/feet_check.py",*[str(p.relative_to(ROOT)) for p in paths]],cwd=ROOT,text=True,capture_output=True,check=True)
    return result.stdout,[json.loads(line) for line in result.stdout.splitlines() if line.strip()]


def all_checks():
    before=read(D/"before/hashes.json")
    protected={p:h for p,h in before.items() if not re.match(r"out/(2-keys|3-inbetweens)/W\d\d\.png$",p.replace("\\","/"))}
    assert all(sha(ROOT/p)==h for p,h in protected.items()),"A reference/guide/tool changed"
    assert all(sha(D/"before/frames"/(f+".png"))==before[str(canonical(f).relative_to(ROOT))] for f in FRAMES),"Original frame backup changed"
    attempts=sorted((D/"attempts").glob("*.json"),key=lambda p:p.stat().st_mtime_ns)
    runs=[read(p) for p in attempts]
    selected=[]
    last_accepted={}
    for record in runs:
        frame,n=record["frame"],record["attempt"]
        path=D/"attempts"/f"{frame}-try-{n}.png"
        assert sha(path)==sha(record["source"]),"Attempt no longer matches imagegen source"
        versions=[]
        for value in record["references"]:
            reference=Path(value)
            if reference.parent==D/"frames" and reference.stem in last_accepted:
                earlier=last_accepted[reference.stem]
                reference=D/"attempts"/f"{earlier['frame']}-try-{earlier['attempt']}.png"
            versions.append({"path":str(reference),"sha256":sha(reference)})
        record["reference_versions"]=versions
        if record.get("accepted"):
            last_accepted[frame]=record
    for frame in FRAMES:
        final=D/"frames"/(frame+".png")
        matches=[r for r in runs if r["frame"]==frame and sha(D/"attempts"/f"{frame}-try-{r['attempt']}.png")==sha(final)]
        assert matches,frame
        record=matches[-1]
        assert record["visual_correct"] and record.get("accepted")
        assert record["feet_check"].get("pass",True)
        assert sha(final)==sha(record["source"])
        count=sum(r["frame"]==frame for r in runs)
        assert count<=6
        selected.append({"frame":frame,"attempt":record["attempt"],"attempt_count":count,"retries":count-1,"sha256":sha(final),"source":record["source"],"canonical":str(canonical(frame).relative_to(ROOT))})
    text_output,measurements=feet([D/"frames"/(f+".png") for f in FRAMES])
    assert len(measurements)==16
    targeted=[m for m in measurements if "pass" in m]
    assert len(targeted)==12 and all(m["pass"] and m["score"]==0 for m in targeted)
    base=read(D/"before/feet.json")
    max_contact=max(abs(value-base[i]["floor_runs"][j][k]) for i,m in enumerate(measurements) for j,run in enumerate(m["floor_runs"]) for k,value in enumerate(run))
    max_ground=max(abs(m["ground"]-base[i]["ground"]) for i,m in enumerate(measurements))
    assert max_contact<=12 and max_ground<=7

    checker=runpy.run_path(str(ROOT/"out/2-keys/verify_stage2.py"))
    reference=checker["inspect"](ROOT/"refs/walk-base.png")
    basic=[checker["inspect_key"](D/"frames"/(f+".png"),reference) for f in FRAMES]
    basic_attempts=[checker["inspect_key"](D/"attempts"/f"{r['frame']}-try-{r['attempt']}.png",reference) for r in runs]
    names=("canvas_1024x1536","opaque","top_between_40_and_110","hip_center_within_512_plus_or_minus_60","height_within_2_5_percent_of_approved_base")
    assert all(all(item["checks"][name] for name in names) for item in basic)
    measure=runpy.run_path(str(D/"arm_check.py"))["measure"]
    hands=[measure(D/"frames"/(f+".png")) for f in FRAMES]
    points=[h["near"]["selected"]["centroid"] for h in hands]
    steps=[round(math.dist(points[i],points[(i+1)%16]),2) for i in range(16)]
    mid_errors=[{"frame":FRAMES[i],"centroid_midpoint_error_px":round(math.dist(points[i],[(points[i-1][j]+points[(i+1)%16][j])/2 for j in range(2)]),2)} for i in range(1,16,2)]
    assert max(steps)<75,"Large arm jump remains"
    assert steps[-1]<15,"Loop hand position does not close"
    assert max(e["centroid_midpoint_error_px"] for e in mid_errors)<20,"Odd hand is outside neighbouring arm midpoint tolerance"
    summary={
        "status":"passed","frames":16,"modified_key_frames":FRAMES[::2],"imagegen_calls":len(runs),
        "retries":len(runs)-16,"targeted_feet_passed":12,"odd_feet_passed":8,
        "max_contact_endpoint_delta_px":max_contact,"max_ground_delta_px":max_ground,
        "protected_reference_guide_tool_files_unchanged":len(protected),
        "all_selected_pngs_identical_to_imagegen_source":True,
        "near_hand_max_adjacent_centroid_step_px":max(steps),"near_hand_loop_step_px":steps[-1],
        "odd_near_hand_midpoint_errors":mid_errors,
        "measurement_note":"Color-component centroids are read-only diagnostics, not anatomical joint tracking; far hand can be occluded. Complete arm phase/anatomy/occlusion also reviewed visually.",
    }
    return summary,selected,runs,measurements,text_output,hands,basic,basic_attempts,steps


def key_review():
    review=runpy.run_path(str(D/"make_review.py"))
    white=runpy.run_path(str(ROOT/"out/3-inbetweens/make_review.py"))["white_preview"]
    pictures=[white(Image.open(D/"frames"/(f+".png"))) for f in FRAMES[::2]]
    sheet=Image.new("RGB",(384*8,616),"white");draw=ImageDraw.Draw(sheet)
    font=ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf",24)
    for i,(frame,image) in enumerate(zip(FRAMES[::2],pictures)):
        draw.text((i*384+192,20),frame,fill="#444452",font=font,anchor="mm")
        sheet.paste(image.resize((384,576),Image.Resampling.LANCZOS),(i*384,40))
    sheet.save(ROOT/"out/2-keys/contact-sheet.png")
    review["save_gif"]([p.resize((512,768),Image.Resampling.LANCZOS) for p in pictures],ROOT/"out/2-keys/preview.gif",[120,130]*4)
    (ROOT/"out/2-keys/review-checks.json").write_text(json.dumps({"source":"out/arm-fix/frames","frame_order":FRAMES[::2],"frame_count":8,"durations_ms":[120,130]*4,"average_fps":8,"loop":0,"background":"white","updated_for_arm_fix":True},indent=2)+"\n",encoding="utf-8")


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--promote",action="store_true")
    parser.add_argument("--verify-only",action="store_true")
    args=parser.parse_args()
    summary,selected,runs,measurements,raw,hands,basic,basic_attempts,steps=all_checks()
    if args.verify_only or (args.promote and (D/"COMPLETE.json").exists()):
        assert (D/"COMPLETE.json").exists()
        assert all(sha(canonical(item["frame"]))==item["sha256"] for item in selected)
        print(json.dumps({"verified":True,**summary},ensure_ascii=False,indent=2))
        return
    write("generation.json",{"tool":"built-in image_gen.imagegen","summary":summary,"selected":selected,"runs":runs})
    write("summary.json",summary)
    write("hands-final.json",hands)
    write("basic-checks-information-only.json",{"note":"Body height/bob and border-green remain informational as specified in Stage3","final":basic,"attempts":basic_attempts})
    write("feet-final.json",measurements)
    (D/"feet-final.jsonl").write_text(raw,encoding="utf-8")
    write("preservation-checks.json",{"old_frame_backups_unchanged":16,"protected_files_unchanged":summary["protected_reference_guide_tool_files_unchanged"],"max_contact_endpoint_delta_px":summary["max_contact_endpoint_delta_px"],"max_ground_delta_px":summary["max_ground_delta_px"]})
    write("arm-continuity-checks.json",{"near_centroid_steps_px":steps,"odd_near_midpoint_errors":summary["odd_near_hand_midpoint_errors"],"loop_step_px":steps[-1],"visual_review":{"all_16_checked":True,"near_small_swing_back_neutral_forward_neutral_back":True,"far_opposite_swing_and_gradual_occlusion":True,"no_extra_fused_or_ghost_arms":True,"critical_W05_W06_and_W10_W11_phase_jumps_removed":True},"limitations":summary["measurement_note"]})
    if not args.promote:
        print(json.dumps(summary,ensure_ascii=False,indent=2))
        return
    before=read(D/"before/hashes.json")
    assert all(sha(canonical(f))==before[str(canonical(f).relative_to(ROOT))] for f in FRAMES),"Canonical frames changed since repair began"
    for item in selected:
        shutil.copy2(D/"frames"/(item["frame"]+".png"),canonical(item["frame"]))
    assert all(sha(canonical(item["frame"]))==item["sha256"] for item in selected)
    key_review()
    for name in ["contact-sheet.png","preview.gif","review-checks.json"]:
        shutil.copy2(D/name,ROOT/"out/3-inbetweens"/name)

    report=[
        "# 摆臂修复交接","",
        "2026-11-10：完整 16 帧双臂修复已完成，已替换正式素材。用户明确要求完全修复并允许在交接文档说明关键帧变动，本次授权覆盖原 Stage3 的“不重画关键帧”限制。","",
        "## 当前使用的素材","",
        "- 完整有序 16 帧：out/arm-fix/frames/W00.png … W15.png，均为 1024×1536、不透明绿底 PNG。",
        "- 正式偶数关键帧：out/2-keys/W00.png、W02.png、W04.png、W06.png、W08.png、W10.png、W12.png、W14.png，8 张均已更新。",
        "- 正式奇数中间帧：out/3-inbetweens/W01.png … W15.png，8 张均已更新；与完整帧目录逐字节一致。",
        "- [完整 16 帧预览](out/arm-fix/preview.gif)：名义 14 fps、白底、无限循环；GIF 以70/80ms量化，16帧1140ms，实际均值14.035fps。",
        "- [双臂慢放](out/arm-fix/arms-preview-4fps.gif)、[修复前后对照](out/arm-fix/before-after-4fps.gif)、[双臂总览](out/arm-fix/arms-contact-sheet.png)。",
        "- [全身两行总览](out/arm-fix/contact-sheet.png)，W00–W07 第一行，W08–W15 第二行。",
        "- out/2-keys/contact-sheet.png、preview.gif 已同步重建（8帧8fps）；out/3-inbetweens/contact-sheet.png、preview.gif 已同步完整16帧。","",
        "## 关键帧具体变动","",
    ]
    for frame in FRAMES[::2]:
        item=next(x for x in selected if x["frame"]==frame)
        m=next(x for x in measurements if x["frame"]==frame)
        report.append(f"- **{frame}**：{KEY_NOTES[frame]}采用本次第 {item['attempt']} 次，脚底接触区间 {m['floor_runs']}。")
    report.extend([
        "",
        "关键帧更改针对手臂、袖口、手及其遮挡处必要的局部裙/发区域。角色身份、朝向、服装设计、腿部身份和既有脚位要求保持。图像生成编辑会带来微小线条/边缘差异，不宣称其他区域逐像素完全一致。",
        f"复测脚底接触端点相对修复前最大差 {summary['max_contact_endpoint_delta_px']}px，地面行最大差 {summary['max_ground_delta_px']}px；未修改测量脚本或目标范围。", "",
        "## 已修复的问题","",
        "- 用后摆→体侧中立→前摆→体侧中立→后摆的完整小幅周期替代原来的两套静态手臂切换。",
        "- W04/W12 已重建为真正的 Passing 垂臂锚点；中间帧重新跟随这些锚点。",
        "- W05 由中立逐步前摆，W11 从前摆回收，消除原 W05→W06 和 W10→W11 的突然反向/切换。",
        "- 近侧手沿身体旁的小弧线运动，手指放松向下；远侧臂反向摆动，并逐渐进入/退出躯干、围裙边缘的自然遮挡。",
        "- W08 等处远侧手只露出一部分指缘是正确遮挡，手臂和手在躯干之后完整连接，不是缺手或截断。", "",
        "## 验证结果","",
        f"- {summary['imagegen_calls']} 次内置 image_gen.imagegen 调用，{summary['retries']} 次重试；每帧不超过6次。全部尝试保存在 out/arm-fix/attempts/，完整提示词、有序参考图版本与 SHA-256 见 generation.json。",
        "- 最终 PNG 与所选 imagegen 原图 SHA-256 相同；没有程序变形、补绘、混合角色帧或 AI 光流插帧。程序仅生成审查总览/GIF、读取测量和复制所选原图。",
        "- 最终16帧的12个有目标帧（8个奇数帧+W04/W06/W10/W14）全部 feet_check.py pass=true、score=0；W00/W02/W08/W12 无脚位目标，只输出实测。",
        f"- 近侧手肤色连通域质心的最大相邻位移 {summary['near_hand_max_adjacent_centroid_step_px']}px；W15→W00 闭环差 {summary['near_hand_loop_step_px']}px。8张奇数帧质心距相邻关键帧质心中点均小于20px。数值是只读诊断代理，不等同于精确骨架关节跟踪；完整运动、手形和远侧遮挡另作逐帧视觉检查。",
        "- 最终16帧画布、不透明度、头顶范围、腰裙中心与相对 approved base 的轮廓高度±2.5%通过；身体bob/边框纯绿按任务说明仅作信息记录。",
        "- W07/W15 前脚仍完整离地，具体数值见下方原版工具输出。", "",
        "## 备份与后续操作","",
        "- 修复前全部16张 PNG：out/arm-fix/before/frames/；修复前报告、脚位数据和预览也在 out/arm-fix/before/ 中。",
        f"- refs / guides / tools / processed 中快照覆盖的 {summary['protected_reference_guide_tool_files_unchanged']} 个文件 SHA-256 未变；旧报告和失败尝试保留为历史。",
        "- 当前交付状态以本文件和 out/arm-fix/summary.json 为准。out/arm-review/ 是修复前的问题记录，已经补充解决状态；早期 Stage2/3 生成记录属于历史。",
        "- 无需重新挑选8张关键帧。后续合成直接使用 out/arm-fix/frames/ 的W00–W15，或正式 out/2-keys 与 out/3-inbetweens 同编号文件。",
        "- 重建审查图：python out/arm-fix/make_review.py；只读核验当前交付：python -W ignore::DeprecationWarning out/arm-fix/finalize.py --verify-only。",
        "- 旧 Stage3 finalize.py 已转发到当前只读核验，避免旧生成记录覆盖最新交付状态。",
        "- 当前交付是走路素材包，桌宠程序的抠除绿底、位置对齐与打包沿用原交接流程。", "",
        "## 本次每帧尝试数","",
    ])
    for item in selected:
        report.append(f"- {item['frame']}：生成 {item['attempt_count']} 次，重试 {item['retries']} 次，最终采用第 {item['attempt']} 次。")
    report.extend(["","## 原版 feet_check.py 最终16帧输出","", "~"*3+"jsonl",raw.rstrip(),"~"*3,""])
    handoff="\n".join(report)
    (ROOT/"HANDOFF.md").write_text(handoff,encoding="utf-8")
    (D/"REPORT.md").write_text(handoff.replace("](out/arm-fix/","]("),encoding="utf-8")
    stage3="# Stage3 摆臂修复后的当前交付\n\n完整16帧双臂已修正，8张关键帧按用户授权同步变动。当前交付与验证见 [HANDOFF.md](../../HANDOFF.md) 和 [完整修复报告](../arm-fix/REPORT.md)。\n\n原脚位目标保持通过；旧报告和预览已备份在 out/arm-fix/before/。本目录奇数帧、两行总览及16帧循环GIF已更新。\n\n"+raw
    (ROOT/"out/3-inbetweens/REPORT.md").write_text(stage3,encoding="utf-8")
    (ROOT/"out/3-inbetweens/summary.json").write_text(json.dumps({**summary,"arm_review":{"status":"passed","report":"out/arm-fix/REPORT.md"},"overall_review_status":"passed","approved_keys_changed":8},ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    (ROOT/"out/2-keys/current-arm-fix.json").write_text(json.dumps({"modified_keys":FRAMES[::2],"handoff":"HANDOFF.md","manifest":"out/arm-fix/generation.json","status":"passed"},indent=2)+"\n",encoding="utf-8")
    old_report=ROOT/"out/2-keys/REPORT.md"
    history=old_report.read_text(encoding="utf-8")
    note="> 当前8张关键帧已按用户授权修正双臂；最新交付见 [HANDOFF.md](../../HANDOFF.md)。以下保留原Stage2历史记录。\n\n"
    if not history.startswith("> 当前8张"):
        old_report.write_text(note+history,encoding="utf-8")
    finding_path=ROOT/"out/arm-review/findings.json"
    finding=read(finding_path)
    finding["historical_status"]=finding["status"]
    finding["status"]="resolved"
    finding["resolved_by"]="out/arm-fix/REPORT.md"
    finding_path.write_text(json.dumps(finding,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    review_report=ROOT/"out/arm-review/REPORT.md"
    old=review_report.read_text(encoding="utf-8")
    if not old.startswith("> 已解决"):
        review_report.write_text("> 已解决：完整16帧双臂已重绘并替换，见 [当前交接](../../HANDOFF.md)。以下是修复前的历史诊断。\n\n"+old,encoding="utf-8")
    readme=ROOT/"README.md"
    value=readme.read_text(encoding="utf-8")
    if not value.startswith("> 最新素材"):
        readme.write_text("> 最新素材：16帧摆臂修复已完成，8张关键帧同步更新。请先读 [HANDOFF.md](HANDOFF.md)。\n\n"+value,encoding="utf-8")
    canonical_raw,canonical_feet=feet([canonical(f) for f in FRAMES])
    assert all(sha(canonical(item["frame"]))==item["sha256"] for item in selected)
    assert [m.get("pass") for m in canonical_feet]==[m.get("pass") for m in measurements]
    write("canonical-feet-final.json",canonical_feet)
    (D/"canonical-feet-final.jsonl").write_text(canonical_raw,encoding="utf-8")
    for folder,count in [("out/2-keys",8),("out/3-inbetweens",16)]:
        with Image.open(ROOT/folder/"preview.gif") as gif:
            assert gif.n_frames==count and gif.info["loop"]==0
    write("COMPLETE.json",{**summary,"promoted":True,"canonical_hashes":{item["canonical"]:item["sha256"] for item in selected},"handoff":"HANDOFF.md"})
    print(json.dumps(summary,ensure_ascii=False,indent=2))


if __name__=="__main__":
    main()
