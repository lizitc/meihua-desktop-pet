"""Record an imagegen attempt, run original feet check plus read-only arm mask,
then stage accepted pixels. Never edits or composites artwork."""
import argparse,json,shutil,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
DIRECTORY=Path(__file__).resolve().parent


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("job",type=Path)
    args=parser.parse_args()
    job=json.loads(args.job.read_text(encoding="utf-8"))
    frame,n=job["frame"],job["attempt"]
    destination=DIRECTORY/"attempts"/f"{frame}-try-{n}.png"
    shutil.copy2(job["source"],destination)
    relative=destination.relative_to(ROOT)
    def check(script):
        result=subprocess.run([sys.executable,"-W","ignore::DeprecationWarning",str(script),str(relative)],cwd=ROOT,text=True,capture_output=True)
        return json.loads(result.stdout.strip())
    feet=check(Path("tools/feet_check.py"))
    arms=check(Path("out/arm-fix/arm_check.py"))
    before=next(item for item in json.loads((DIRECTORY/"before/feet.json").read_text(encoding="utf-8")) if item["frame"]==frame)
    error=max(abs(v-before["floor_runs"][i][j]) for i,run in enumerate(feet["floor_runs"]) for j,v in enumerate(run)) if len(feet["floor_runs"])==len(before["floor_runs"]) else 999
    preserved=error<=12 and abs(feet["ground"]-before["ground"])<=7
    accepted=bool(job["visual_correct"] and feet.get("pass",True) and preserved)
    record={**job,"feet_check":feet,"arms":arms,"lower_body_floor_max_error":error,"lower_body_ground_delta":feet["ground"]-before["ground"],"lower_body_preserved":preserved,"accepted":accepted}
    (DIRECTORY/"attempts"/f"{frame}-try-{n}.json").write_text(json.dumps(record,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    if accepted:
        shutil.copy2(destination,DIRECTORY/"frames"/f"{frame}.png")
    print(json.dumps({"frame":frame,"attempt":n,"feet":feet,"near":arms["near"]["selected"],"far":arms["far"]["selected"],"floor_error":error,"accepted":accepted},ensure_ascii=False))


if __name__=="__main__":
    main()
