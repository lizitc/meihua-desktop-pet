"""Promote only W05/W13, rebuild review assets and record Stage 3b results.
Run once after audit.py and visual review: python out/3-inbetweens/stage3b/finalize.py
No artwork pixels are changed by this script.
"""
import hashlib,json,shutil,subprocess,sys
from pathlib import Path
from PIL import Image
D=Path(__file__).resolve().parent
ROOT=D.parents[2]
def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def read(p): return json.loads(Path(p).read_text(encoding="utf-8-sig"))
def write(name,obj): (D/name).write_text(json.dumps(obj,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
def canonical(i): return ROOT/("out/3-inbetweens" if i%2 else "out/2-keys")/f"W{i:02d}.png"
assert not (D/"COMPLETE.json").exists(),"Stage 3b already promoted; inspect COMPLETE.json"
initial=read(D/"before-hashes.json")
assert len(initial)==16
assert all(sha(x["path"]).lower()==x["sha256"].lower() for x in initial),"Official frames changed since baseline"
generation=read(D/"generation.json")
selected=[r for r in generation["records"] if r["selected"]]
assert [(r["frame"],r["attempt"]) for r in selected]==[("W05",6),("W13",6)]
preservation=read(D/"preservation.json")
for r in selected:
    assert r["feet_check"]["pass"] and r["feet_check"]["score"]==0 and r["visual_correct"]
    assert sha(ROOT/r["attempt_path"])==sha(r["source"])==r["sha256"]
    original=next(x for x in initial if Path(x["path"]).stem==r["frame"])
    backup=ROOT/"out/3-inbetweens/attempts"/(r["frame"]+"-before-3b.png")
    assert sha(backup).lower()==original["sha256"].lower()
for r in selected:
    shutil.copy2(ROOT/r["attempt_path"],canonical(int(r["frame"][1:])))
assert all(sha(canonical(int(r["frame"][1:])))==r["sha256"] for r in selected)
result=subprocess.run([sys.executable,"-W","ignore::DeprecationWarning","tools/feet_check.py",*[str(canonical(i).relative_to(ROOT)) for i in range(16)]],cwd=ROOT,text=True,capture_output=True,check=True)
measurements=[json.loads(line) for line in result.stdout.splitlines() if line.strip()]
assert len(measurements)==16
targeted=[m for m in measurements if "pass" in m]
assert len(targeted)==12 and all(m["pass"] and m["score"]==0 for m in targeted)
(D/"feet-final.jsonl").write_text(result.stdout,encoding="utf-8")
write("feet-final.json",measurements)
# Read-only ROI selected and checked visually: excludes the far support shin/foot.
crop=Image.open(canonical(13)).convert("RGB").crop((480,1300,600,1401))
ys=[i//120+1300 for i,(r,g,b) in enumerate(crop.getdata()) if g-max(r,b)<60]
near_bottom=max(ys)
visual_lift=measurements[13]["ground"]-near_bottom
assert 50<=visual_lift<=80
write("visual-foot-check.json",{"frame":"W13","visual_review_roi":[480,1300,600,1401],"near_foot_lowest_row":near_bottom,"ground":measurements[13]["ground"],"lift_px":visual_lift,"method":"Read-only crop confirmed visually to contain the near floating foot, excluding the grounded far foot."})
subprocess.run([sys.executable,"-W","ignore::DeprecationWarning","out/3-inbetweens/make_review.py"],cwd=ROOT,text=True,capture_output=True,check=True)
unchanged=[x for x in initial if Path(x["path"]).stem not in {"W05","W13"}]
assert len(unchanged)==14 and all(sha(x["path"]).lower()==x["sha256"].lower() for x in unchanged)
with Image.open(ROOT/"out/3-inbetweens/preview.gif") as gif:
    assert gif.n_frames==16 and gif.info["loop"]==0
with Image.open(ROOT/"out/3-inbetweens/contact-sheet.png") as image:
    assert image.size==(3072,1232)
summary={
    "stage":"3b","date":"2026-11-10","status":"complete",
    "tool":"built-in image_gen.imagegen",
    "modified_official_frames":["W05","W13"],"protected_official_frames_unchanged":14,
    "imagegen_calls":12,"retries":{"W05":5,"W13":5},
    "selected_attempts":{"W05":6,"W13":6},
    "targeted_feet_checks_passed":12,"unmeasured_frames":["W00","W02","W08","W12"],
    "source_pixels_programmatically_edited":False,"W13_visual_foot_lift_px":visual_lift,
    "review_assets":["out/3-inbetweens/contact-sheet.png","out/3-inbetweens/preview.gif"],
    "report":"out/3-inbetweens/stage3b/REPORT.md",
    "canonical_sha256":{r["frame"]:sha(canonical(int(r["frame"][1:]))) for r in selected}
}
write("summary.json",summary)
lines=[
"# Stage 3b：W05 / W13 摆动脚时序修正","",
"2026-11-10。只执行 Stage 3b，已替换两张正式中间帧；其余 14 张正式帧 SHA-256 与开始前一致。","",
"## 结果","",
"| 帧 | swing_tip 修正前 → 后 | 支撑脚趾 x | 原工具判定 | 尝试 / 重试 |",
"|---|---|---|---|---|",
"| W05 | 574 → 645 | 477（目标451–491） | pass=true，score=0；摆动脚离地85px | 6 / 5 |",
"| W13 | 613 → 557 | 528（目标510–550） | pass=true，score=0；脚部审查ROI离地64px | 6 / 5 |","",
"- W05：远侧腿在后方遮挡关系中前摆，完整脚掌离地；近侧腿支撑。",
"- W13：近侧腿前景通过，摆动脚收回至支撑脚旁；远侧腿支撑。",
"- 两帧均视觉检查：两条完整腿、两个完整袜脚、近远腿身份正确，无多肢或融合；双臂、手的摆动姿势保留。",
"- 未改变其余正式帧；未修改 refs、guides、tools，也未更新旧 out/arm-fix/frames/ 副本。后续应使用正式 out/2-keys/ 与 out/3-inbetweens/。",
"- 本次全部采用内置 image_gen.imagegen；正式 PNG 与所选生成原图逐字节一致，没有程序变形、拼接、补绘或插帧。","",
"## 保留区域检查与限制","",
"- W05 支撑脚接触区间由 [329,478] 到 [329,477]，地面行1477未变；W13 接触区间[403,528]未变，地面行由1458到1456。",
"- 双臂和手的前后对照见 [arms-comparison.png](arms-comparison.png)，手部颜色连通域边界最大差3px；姿势视觉检查保留。颜色阈值可能拆分手指连通域，质心只作诊断。",
"- 两张局部生成编辑在非腿区域仍有微小线条、边缘、色阶差异，不宣称逐像素不变；具体区域轮廓IoU和色差记录见 [preservation.json](preservation.json)。",
"- 画布1024×1536、不透明、头顶范围、腰裙中心和相对模型轮廓高度检查通过。身体bob与边框绿仅记录，不作为本阶段重试目标。没有未通过脚位目标的采用帧。","",
"## 文件","",
"- 正式输出：[W05.png](../W05.png)、[W13.png](../W13.png)。",
"- 原图备份：[W05-before-3b.png](../attempts/W05-before-3b.png)、[W13-before-3b.png](../attempts/W13-before-3b.png)。",
"- 每次尝试：../attempts/W05-3b-try-1.png … W05-3b-try-6.png；W13-3b-try-1.png … W13-3b-try-6.png。",
"- [16帧两行总览](../contact-sheet.png)：W00–W07在第一行，W08–W15在第二行。",
"- [16帧白底循环GIF](../preview.gif)：名义14fps；GIF时间以70/80ms量化，总长1140ms，loop=0。",
"- 全部提示词、有序参考图版本、生成原图路径、SHA-256与视觉记录：[generation.json](generation.json)。",
"- 初测及全部尝试测量：[before-feet.jsonl](before-feet.jsonl)、[attempt-feet.jsonl](attempt-feet.jsonl)。","",
"## 每次尝试","",
"| 帧 / 次数 | stance_toe | swing_tip | swing_lift | score | 结果 |",
"|---|---:|---:|---:|---:|---|"
]
for r in generation["records"]:
    m=r["feet_check"]
    note="采用" if r["selected"] else ("未采用：腰裙中心偏左0.33px" if r["frame"]=="W13" and r["attempt"]==4 else ("拒绝：支撑脚移动" if not r["visual_correct"] else "拒绝：脚位目标未通过"))
    lines.append(f"| {r['frame']} / {r['attempt']} | {m.get('stance_toe','—')} | {m.get('swing_tip','—')} | {m.get('swing_lift','—')} | {m['score']} | {note} |")
lines.extend([
"","## 最终16帧 feet_check.py 原始输出","",
"原脚本未修改。12个有目标的帧全部pass=true、score=0；W00/W02/W08/W12无目标，只输出测量。W13的swing_lift没有目标，原工具只扫描支撑脚趾右侧40px以外，不能代表窄姿态下整个摆动脚的最低点；本帧离地高度另作视觉检查。","",
"```jsonl",result.stdout.rstrip(),"```",""])
(D/"REPORT.md").write_text("\n".join(lines),encoding="utf-8")
write("COMPLETE.json",summary)
print(json.dumps(summary,ensure_ascii=False,indent=2))

