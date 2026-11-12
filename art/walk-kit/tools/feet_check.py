"""Foot placement check for walk key drawings (green-screen PNGs, 1024x1536).

    python tools/feet_check.py out/2-keys/W06.png [more.png ...]

The frame name (W00..W15, or T1/T2 for the Stage 4 turn) is taken from the file
name, so attempts such as out/2-keys/attempts/W06-2c-try-3.png are checked
against the W06 targets.

All x values are canvas pixels (the character walks toward +x). "ground" is the
lowest character row; lifts are measured up from it. A frame passes when every
targeted value is inside its range; "score" is the total distance outside the
ranges (0 = pass), so among failed tries keep the one with the lowest score.
"""
import json
import re
import sys

from PIL import Image

# stance = the foot carrying the weight; toe / heel = right-most / left-most pixel
# of that foot at floor level. "flat": True = whole foot on the floor, False = on
# its toes (heel lifted), absent = not checked. "pick": "front" = the stance foot
# is the front-most foot on the floor and the back toes may still touch it too;
# otherwise the stance foot must be the ONLY foot touching the floor.
TARGETS = {
    # Stage 2c keys
    "W04": {"stance_toe": (500, 540), "stance_flat": True},
    "W06": {"stance_toe": (395, 435), "stance_flat": False, "swing_toe": (670, 740), "swing_lift": (20, 55)},
    "W10": {"stance_toe": (657, 697), "stance_flat": True},
    "W14": {"stance_toe": (437, 477), "stance_flat": False, "swing_toe": (630, 700), "swing_lift": (20, 55)},
    # Stage 3 in-betweens: halfway between the neighbouring keys
    "W01": {"pick": "front", "stance_heel": (524, 564)},
    "W03": {"stance_toe": (543, 583), "stance_flat": True},
    "W07": {"stance_toe": (349, 389), "stance_flat": False, "swing_toe": (740, 780), "swing_lift": (14, 45)},
    "W09": {"pick": "front", "stance_heel": (581, 621)},
    "W11": {"stance_toe": (612, 652), "stance_flat": True},
    "W15": {"stance_toe": (392, 432), "stance_flat": False, "swing_toe": (682, 722), "swing_lift": (14, 45)},
    # Stage 3b: the swinging foot halfway between the neighbouring keys (swing_tip, see SWING_ZONE)
    "W05": {"stance_toe": (451, 491), "swing_tip": (612, 652), "swing_lift": (55, 100)},
    "W13": {"stance_toe": (510, 550), "swing_tip": (528, 568)},
    # Stage 4 turn, from the standing art (eyes_x 499, feet 439-655 on this canvas) to refs/walk-base.png
    # (eyes_x 550, feet 429-587): the face moves right as she turns, the feet stay on the same spot
    "T1": {"eyes_x": (508, 526), "feet_left": (420, 455), "feet_right": (600, 650)},
    "T2": {"eyes_x": (525, 543), "feet_left": (420, 455), "feet_right": (580, 630)},
}
STANCE_KEYS = ("pick", "stance_toe", "stance_heel", "stance_flat", "swing_toe", "swing_tip", "swing_lift")
FLOOR_BAND = 12      # rows above ground that count as "touching the floor"
FEET_BAND = 40       # feet_left / feet_right: left-/right-most character pixel in the bottom 40 rows
EYE_BOX = (330, 240, 760, 420)  # x0, y0, x1, y1 of the face area; eyes_x = centre of the dark violet iris pixels
FLAT_MIN = 95        # a flat foot touches the floor over at least this many px
TOE_MAX = 85         # a foot standing on its toes touches over at most this many px
# swing_tip = right-most character pixel between 50 and 160 px above the ground. That zone holds a lifted
# foot; the supporting leg's shin there is already 45-90 px behind its toes, so a lifted foot that is
# ahead of the shin is what gets measured.
SWING_ZONE = (50, 160)


def measure(path, pick="only"):
    img = Image.open(path).convert("RGB")
    w, h = img.size
    data = img.getdata()
    char = bytearray(w * h)
    for i, (r, g, b) in enumerate(data):
        if g - max(r, b) < 60:
            char[i] = 1

    def row_count(y):
        o = y * w
        return sum(char[o:o + w])

    ground = next((y for y in range(h - 1, -1, -1) if row_count(y) >= 6), h - 1)

    # floor runs: columns with character pixels in the bottom FLOOR_BAND rows
    cols = [0] * w
    for y in range(max(0, ground - FLOOR_BAND), ground + 1):
        o = y * w
        for x in range(w):
            if char[o + x]:
                cols[x] = 1
    runs, start, gap = [], None, 0
    for x in range(w + 1):
        on = x < w and cols[x]
        if on:
            if start is None:
                start = x
            gap = 0
        elif start is not None:
            gap += 1
            if gap > 3 or x == w:
                end = x - gap
                if end - start + 1 >= 6:
                    runs.append([start, end])
                start, gap = None, 0
    out = {"file": path, "size": [w, h], "ground": ground, "floor_runs": runs}

    xs = [x for y in range(max(0, ground - FEET_BAND), ground + 1) for x in range(w) if char[y * w + x]]
    if xs:
        out["feet_left"], out["feet_right"] = min(xs), max(xs)
    sx = n = 0
    for y in range(EYE_BOX[1], EYE_BOX[3]):
        for x in range(EYE_BOX[0], EYE_BOX[2]):
            i = y * w + x
            if char[i]:
                r, g, b = data[i]
                if r > g and b > g + 25 and r + g + b < 420:
                    sx += x
                    n += 1
    if n >= 150:
        out["eyes_x"] = round(sx / n)
    out["eyes_px"] = n

    tip = None
    for y in range(max(0, ground - SWING_ZONE[1]), max(0, ground - SWING_ZONE[0]) + 1):
        o = y * w
        for x in range(w - 1, -1, -1):
            if char[o + x]:
                tip = x if tip is None else max(tip, x)
                break
    if tip is not None:
        out["swing_tip"] = tip

    if len(runs) == 1 or (pick == "front" and len(runs) == 2):
        sx0, sx1 = runs[-1]
        out["stance_toe"] = sx1
        out["stance_heel"] = sx0
        out["stance_width"] = sx1 - sx0 + 1
        # front swing foot: character pixels right of the stance toe in the bottom 200 rows
        lim = sx1 + 40
        low, tip = None, None
        for y in range(max(0, ground - 200), ground + 1):
            o = y * w
            for x in range(lim, w):
                if char[o + x]:
                    low = y
                    tip = x if tip is None else max(tip, x)
        if low is not None:
            out["swing_toe"] = tip
            out["swing_lift"] = ground - low
    return out


def check(m, frame):
    t = TARGETS.get(frame)
    if not t:
        return None
    fails, score = [], 0

    def rng(name, lo, hi):
        nonlocal score
        v = m.get(name)
        if v is None:
            fails.append(f"{name}: not found")
            score += 200
        elif not lo <= v <= hi:
            d = lo - v if v < lo else v - hi
            fails.append(f"{name} {v} (want {lo}-{hi})")
            score += d

    for name in ("eyes_x", "feet_left", "feet_right"):
        if name in t:
            rng(name, *t[name])
    if not any(k in t for k in STANCE_KEYS):
        pass
    elif "stance_width" not in m:
        if t.get("pick") == "front":
            fails.append(f"{len(m['floor_runs'])} feet touch the floor (want the front foot planted, plus at most the back toes)")
        else:
            fails.append(f"{len(m['floor_runs'])} feet touch the floor (want exactly 1; the other foot must be lifted)")
        score += 300
    else:
        for name in ("stance_toe", "stance_heel"):
            if name in t:
                rng(name, *t[name])
        wd = m["stance_width"]
        flat = t.get("stance_flat")
        if flat is True and wd < FLAT_MIN:
            fails.append(f"stance foot not flat (touches {wd} px, want >= {FLAT_MIN})")
            score += FLAT_MIN - wd
        if flat is False and wd > TOE_MAX:
            fails.append(f"stance heel not lifted (touches {wd} px, want <= {TOE_MAX})")
            score += wd - TOE_MAX
        for name in ("swing_toe", "swing_tip", "swing_lift"):
            if name in t:
                rng(name, *t[name])
    return {"pass": not fails, "score": score, "fails": fails}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    worst = 0
    for p in sys.argv[1:]:
        f = re.search(r"W\d\d|T\d", p.replace("\\", "/").split("/")[-1])
        frame = f.group(0) if f else None
        m = measure(p, TARGETS.get(frame, {}).get("pick", "only"))
        c = check(m, frame)
        m["frame"] = frame
        if c:
            m.update(c)
            worst = max(worst, c["score"])
        print(json.dumps(m, ensure_ascii=False))
    sys.exit(1 if worst else 0)
