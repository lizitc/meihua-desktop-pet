"""Read-only Stage 3b audit. Artwork is never edited, blended or transformed."""
import hashlib,json,math,runpy,subprocess,sys
from pathlib import Path
import numpy as np
from PIL import Image

D=Path(__file__).resolve().parent
ROOT=D.parents[2]
PY=sys.executable
def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def write(name,data): (D/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
def feet(paths):
    args=[str(Path(p).relative_to(ROOT)) for p in paths]
    r=subprocess.run([PY,"-W","ignore::DeprecationWarning","tools/feet_check.py",*args],cwd=ROOT,text=True,capture_output=True)
    if r.returncode not in (0,1): raise RuntimeError(r.stderr)
    return r.stdout,[json.loads(line) for line in r.stdout.splitlines() if line.strip()]
def canon(i):
    return ROOT/("out/3-inbetweens" if i%2 else "out/2-keys")/f"W{i:02d}.png"
gen=json.loads((D/"generation.json").read_text(encoding="utf-8-sig"))
records=gen["records"]
for r in records:
    r["attempt_path"]=f"out/3-inbetweens/attempts/{r['frame']}-3b-try-{r['attempt']}.png"
    r["sha256"]=sha(ROOT/r["attempt_path"])
    assert r["sha256"]==sha(r["source"]),"Attempt no longer matches imagegen source"
    r["reference_versions"]=[{"path":p,"sha256":sha(ROOT/p)} for p in r["references"]]
raw,measurements=feet([ROOT/r["attempt_path"] for r in records])
for r,m in zip(records,measurements): r["feet_check"]=m
(D/"attempt-feet.jsonl").write_text(raw,encoding="utf-8")
baseline_paths=[ROOT/"out/3-inbetweens/attempts"/f"W{i:02d}-before-3b.png" if i in (5,13) else canon(i) for i in range(16)]
raw,before_feet=feet(baseline_paths)
(D/"before-feet.jsonl").write_text(raw,encoding="utf-8")
assert before_feet[5]["swing_tip"]==574 and before_feet[13]["swing_tip"]==613
checker=runpy.run_path(str(ROOT/"out/2-keys/verify_stage2.py"))
base=checker["inspect"](ROOT/"refs/walk-base.png")
basic=[checker["inspect_key"](ROOT/r["attempt_path"],base) for r in records]
write("basic-checks.json",basic)
arm=runpy.run_path(str(ROOT/"out/arm-fix/arm_check.py"))["measure"]
pres=[]
for r in records:
    if not r["selected"]: continue
    assert r["visual_correct"] and r["feet_check"]["pass"] and r["feet_check"]["score"]==0
    index=int(r["frame"][1:])
    old=ROOT/"out/3-inbetweens/attempts"/(r["frame"]+"-before-3b.png")
    new=ROOT/r["attempt_path"]
    a=np.asarray(Image.open(old).convert("RGB")).astype(np.int16)
    b=np.asarray(Image.open(new).convert("RGB")).astype(np.int16)
    boxes={"head":(260,50,720,440),"upper_body_and_arms":(80,440,735,925)}
    if index==5:
        boxes.update({"near_arm_hand":(360,440,525,945),"far_arm_hand":(620,600,715,905),"support_foot":(310,1400,500,1490)})
    else:
        boxes.update({"near_arm_hand":(350,440,455,945),"far_arm_hand":(610,580,720,925),"support_foot":(390,1400,540,1475)})
    metrics={}
    for label,(x0,y0,x1,y1) in boxes.items():
        aa=a[y0:y1,x0:x1]; bb=b[y0:y1,x0:x1]
        ma=aa[:,:,1]-np.maximum(aa[:,:,0],aa[:,:,2])<60
        mb=bb[:,:,1]-np.maximum(bb[:,:,0],bb[:,:,2])<60
        union=ma|mb
        metrics[label]={"box":[x0,y0,x1,y1],"silhouette_iou":round(float((ma&mb).sum()/union.sum()),6),"mean_abs_rgb_error_character_union":round(float(np.abs(aa-bb)[union].mean()),4)}
    old_arm,new_arm=arm(old),arm(new)
    deltas={}
    for side in ("near","far"):
        x=old_arm[side]["selected"]; y=new_arm[side]["selected"]
        if x and y: deltas[side]={"before":x,"after":y,"centroid_shift_px":round(math.dist(x["centroid"],y["centroid"]),4)}
    before=before_feet[index]; after=r["feet_check"]
    floor_deltas=[[v-before["floor_runs"][i][j] for j,v in enumerate(run)] for i,run in enumerate(after["floor_runs"])]
    assert len(before["floor_runs"])==len(after["floor_runs"])==1
    assert max(abs(v) for run in floor_deltas for v in run)<=1
    assert abs(before["ground"]-after["ground"])<=2
    for v in deltas.values():
        v["bbox_max_edge_delta_px"]=max(abs(x-y) for x,y in zip(v["before"]["bbox"],v["after"]["bbox"]))
        assert v["bbox_max_edge_delta_px"]<=3
    # Skin-color connected components can split across fingers after tiny shade edits.
    # Their centroids are informational; bbox edges plus visual review check the pose.
    selected_basic=basic[records.index(r)]
    for name in ("canvas_1024x1536","opaque","top_between_40_and_110","hip_center_within_512_plus_or_minus_60","height_within_2_5_percent_of_approved_base"):
        assert selected_basic["checks"][name],(r["frame"],name)
    pres.append({"frame":r["frame"],"attempt":r["attempt"],"ground_delta_px":after["ground"]-before["ground"],"floor_endpoint_deltas_px":floor_deltas,"regions":metrics,"hands":deltas,"note":"Read-only diagnostics. Small imagegen edge/line differences may remain; no pixel-identical preservation claim for edited frames."})
write("preservation.json",pres)
from PIL import ImageDraw,ImageFont
sheet=Image.new("RGB",(900,1110),"white")
draw=ImageDraw.Draw(sheet)
font=ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf",20)
for row,(frame,attempt) in enumerate((("W05",6),("W13",6))):
    for col,label in enumerate(("before","after")):
        source=ROOT/"out/3-inbetweens/attempts"/(f"{frame}-before-3b.png" if col==0 else f"{frame}-3b-try-{attempt}.png")
        draw.text((col*450+15,row*555+5),f"{frame} {label}",font=font,fill="black")
        sheet.paste(Image.open(source).convert("RGB").crop((280,430,730,955)),(col*450,row*555+30))
sheet.save(D/"arms-comparison.png")
gen["records"]=records
write("generation.json",gen)
initial=json.loads((D/"before-hashes.json").read_text(encoding="utf-8-sig"))
unchanged=[Path(x["path"]).name for x in initial if sha(x["path"]).lower()==x["sha256"].lower()]
write("pre-promotion-audit.json",{"official_frames_still_unchanged":unchanged,"selected":[r["frame"] for r in records if r["selected"]],"source_pngs_edited_by_program":False})
assert len(unchanged)==16
print(json.dumps({"selected":[{"frame":r["frame"],"attempt":r["attempt"],"feet":r["feet_check"]} for r in records if r["selected"]],"preservation":pres,"all_16_official_frames_unchanged_before_promotion":True},ensure_ascii=False,indent=2))

