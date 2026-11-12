"""Read-only color-component measurements for the two visible hands.
These are hand-skin centroids/top-edge wrist proxies, not skeleton estimation.
Visual review must confirm that each selected component is a hand.
"""
import json
import re
import sys
from collections import deque
from pathlib import Path

from PIL import Image


def hand(image, box):
    x0,y0,x1,y1=box
    crop=image.crop(box)
    w,h=crop.size
    mask=set()
    for i,(r,g,b) in enumerate(crop.getdata()):
        if r-g>=8 and g-b>=4 and g>=145 and r-b>=13:
            mask.add(i)
    components=[]
    while mask:
        start=mask.pop()
        queue=deque([start])
        points=[]
        while queue:
            i=queue.popleft()
            x,y=i%w,i//w
            points.append((x+x0,y+y0))
            for nx,ny in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
                if 0<=nx<w and 0<=ny<h:
                    n=ny*w+nx
                    if n in mask:
                        mask.remove(n)
                        queue.append(n)
        if len(points)>=80:
            xs=[p[0] for p in points]; ys=[p[1] for p in points]
            top=min(ys)
            band=[p for p in points if p[1]<=top+6]
            components.append({
                "area":len(points),
                "centroid":[round(sum(xs)/len(xs),2),round(sum(ys)/len(ys),2)],
                "bbox":[min(xs),top,max(xs)+1,max(ys)+1],
                "wrist_proxy":[round(sum(p[0] for p in band)/len(band),2),top],
            })
    components=[c for c in components if c["centroid"][1]>=820 and c["bbox"][1]>=785 and c["bbox"][3]-c["bbox"][1]>=25 and c["bbox"][2]-c["bbox"][0]<=120]
    components.sort(key=lambda c:c["area"],reverse=True)
    return {"selected":components[0] if components else None,"candidates":components[:4]}


def measure(path):
    image=Image.open(path).convert("RGB")
    return {
        "file":str(path),
        "frame":re.search(r"W\d\d",Path(path).name).group(0),
        "near":hand(image,(290,780,580,940)),
        "far":hand(image,(650,770,810,940)),
        "method":"Skin-color connected components; visually confirm components before using the measurements.",
    }


if __name__=="__main__":
    for path in sys.argv[1:]:
        print(json.dumps(measure(path),ensure_ascii=False))
