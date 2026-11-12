# Codex task: redraw Misono Meihua's walk cycle

You are producing hand-drawn-quality animation frames for a desktop-pet app. All paths are relative to this folder (`art/walk-kit/`). Use your built-in image generation and pass the listed files as **reference images in the listed order**. Save outputs under `out/`. Do **only the stage the user asks for**, then stop and report.

## Why this is being redone (avoid these)

The previous walk was rejected for three reasons:
1. **Style and identity drift.** The poses were drawn small on a multi-figure sprite sheet, so faces were blurry and off-model.
2. **Inconsistency between drawings.** Leg thickness, hip height, skirt length and hair volume changed from frame to frame.
3. **Mushy motion.** AI frame interpolation smeared the limbs.

This time:
- every drawing is **one figure per image at full resolution**;
- every drawing follows a geometric **pose guide** on a fixed ground line;
- the identity is locked to one approved model image.

Never draw several figures in one image. Never blend two drawings into one.

## Fixed blocks (paste into every prompt)

**[CHARACTER]**
```text
CHARACTER (keep exactly, she must be instantly recognizable as the girl in ich01A_101.png): Misono Meihua, a petite dog-girl (kemonomimi). Soft floppy WHITE DOG EARS hanging beside her face (dog ears, NOT rabbit ears); on her LEFT ear a tiny navy-blue bow and a tiny peach bow (in a right-facing three-quarter view this is the ear nearer to the viewer); pink frilled maid headband; very long wavy WHITE hair with two low side bunches tied with small white flowers; large violet eyes; fluffy white dog tail coming from under the back of the skirt; white blouse with puffed short over-sleeves and fitted long sleeves, pink ribbons on the sleeves, red bow tie at the collar; pink high-waisted suspender skirt with a white frilled hem; pale cream-pink frilled apron; white thigh-high stockings with small purple bows; NO SHOES, stocking feet smooth and softly rounded with no toe lines and no ankle wrinkles. Small soft hands with five fingers and rounded fingertips. Bright clean face with a gentle blush, no heavy shadows on the face. Same head-to-body proportions as ich01A_101.png (a little over 4.5 heads tall).
STYLE: identical to ich01A_101.png. Soft pastel Japanese visual-novel illustration, thin clean even lineart, very light soft cel shading, same palette and the same level of detail. Not painterly, not sketchy, not 3D, no blur, no extra decoration.
```

**[TECH]**
```text
TECHNICAL (must follow):
- Output exactly 1024x1536 (portrait). Exactly ONE character and nothing else.
- Opaque, perfectly flat, pure GREEN background #00FF00 everywhere, including every gap between hair strands, arms and legs. No gradient, no floor, no cast shadow, no glow, no rim light. No green tint or green reflection on the character.
- Same scale and placement as the pose guide: the soles touch the black ground line at y=1480; the top of the headband sits on the pink dashed line (about y=64-83 depending on the frame); the pelvis stays on the vertical dashed centre line x=512. The whole figure is about 1400 px tall. Never crop hair, ears, tail, hands or feet.
- The pose guide is a DIAGRAM ONLY: never draw the mannequin, its colours, lines, labels, grid or text.
- No text, letters, signature or watermark anywhere.
```

## Stage 1: walk model (3/4 view facing right)

**Goal:** one approved model drawing of her in the walk's camera angle. Every later frame copies it.

**References, in order:**
1. `refs/ich01A_101.png`
2. `refs/portrait.png`
3. `guides/guide-BASE.png`
4. `refs/scale-reference.png`

**Prompt:**
```text
Use case: character model sheet for 2D animation (identity-preserving redraw).
Reference 1 is the APPROVED design of this character, front view: the single source of truth for her face, eye shape and colour, hair, ears, costume, colours and line quality. Reference 2 is a close-up of the same face. Reference 3 is a pose diagram (copy pose, size and placement only). Reference 4 shows the approved art on the target canvas: match this exact head size, body size and ground line.
Draw ONE full-body image of the same girl standing still in a gentle THREE-QUARTER VIEW turned toward screen RIGHT, about 35-40 degrees from the front: her face, both eyes and her chest are still clearly visible to the viewer, her nose and gaze point to the right. Feet together and flat on the ground, legs straight and relaxed, arms hanging naturally with soft open hands near the skirt, calm sweet closed-mouth smile, eyes open. The long hair falls behind her back and over the far shoulder; the tail shows from behind the skirt on the left side of the image.
[CHARACTER]
[TECH]
```

Generate **4 candidates**: `out/1-base/base-1.png` … `base-4.png`. Then stop.

The user picks one and copies it to `refs/walk-base.png`. If none is good, the user may ask for more candidates.

## Stage 2: the 8 key drawings

Requires `refs/walk-base.png`. One image per key.

**Generation order and continuity reference** (the 4th reference is the already approved key named here):

| Frame | Guide | 4th reference | Pose |
|---|---|---|---|
| W04 | `guides/guide-W04.png` | none | PASSING (near leg supports) |
| W12 | `guides/guide-W12.png` | W04 | PASSING (far leg supports) |
| W00 | `guides/guide-W00.png` | W04 | CONTACT (near leg forward) |
| W08 | `guides/guide-W08.png` | W00 | CONTACT (far leg forward) |
| W02 | `guides/guide-W02.png` | W00 | DOWN (onto near leg) |
| W10 | `guides/guide-W10.png` | W08 | DOWN (onto far leg) |
| W06 | `guides/guide-W06.png` | W04 | UP (near leg pushes off) |
| W14 | `guides/guide-W14.png` | W12 | UP (far leg pushes off) |

**References, in order:**
1. `refs/walk-base.png`
2. the guide from the table
3. `refs/ich01A_101.png`
4. the continuity frame from `out/2-keys/` (if any)

**Prompt template** (replace `<FRAME>` and `<POSE>`):
```text
Use case: professional 2D hand-drawn animation key drawing, identity-locked.
Reference 1 is the approved three-quarter-right model of this exact character: copy her face, hair, ears, costume, colours, proportions and line quality EXACTLY; only the pose changes. Reference 2 is the pose diagram for this frame: dark blue = the NEAR leg and arm (the side facing the viewer), light blue = the FAR leg and arm, black line = floor; match the angles of the thighs, shins, feet and arms and the height of the head. Reference 3 is the design source of truth (front view) for face and costume details. Reference 4 (when given) is an already approved frame of this same walk: keep the same rendering, head size, hair volume, skirt length, apron shape and stocking thickness.
Draw frame <FRAME> of a gentle, cute walk cycle toward screen RIGHT. The character keeps the same three-quarter view as reference 1 (she does NOT turn into a full side profile and is NOT mirrored).
<POSE>
Walk style: light, small, graceful steps of a petite girl; upright posture; head steady and level with only the tiny bob given by the diagram; arms swing gently opposite to the legs with soft OPEN hands (never fists); skirt hem, apron frills, long hair, floppy ears and tail follow the motion with a slight delay. Exactly two legs and two socked feet, both complete from thigh to toe; the far leg is partly hidden behind the near leg and the skirt where they overlap, never cut off or merged.
[CHARACTER]
[TECH]
```

**`<POSE>` text for each key:**
```text
W00 CONTACT: The NEAR leg has just stepped forward, almost straight, its heel touching the floor with the toes slightly raised. The FAR leg is extended behind, only its toes touching the floor, heel lifted. Near arm swings slightly back, far arm slightly forward. Body at middle height.
W02 DOWN: Weight drops onto the NEAR leg: it is under the body slightly forward, knee softly bent, foot flat on the floor. The FAR leg behind is peeling off the floor, knee bending, toes just leaving the ground. Lowest body position of the step (head about 7 px lower than in W00).
W04 PASSING: The NEAR leg is straight and vertical under the body, foot flat, carrying all the weight. The FAR leg passes behind it with the knee bent and pointing forward and the foot lifted a little above the floor. Arms close to the sides. Body a little higher than in W00.
W06 UP: The NEAR leg is behind the body pushing off, heel lifted so only the front of the foot touches the floor. The FAR leg swings forward, knee almost straight, foot just above the floor about to land. Highest body position (head about 12 px higher than in W00).
W08 CONTACT: The FAR leg has just stepped forward, almost straight, its heel touching the floor with the toes slightly raised. The NEAR leg is extended behind, only its toes touching the floor, heel lifted. Near arm slightly forward, far arm slightly back. Body at middle height. (Same idea as W00 with the legs swapped; she still faces right in the same three-quarter view.)
W10 DOWN: Weight drops onto the FAR leg, slightly forward, knee softly bent, foot flat. The NEAR leg behind is peeling off the floor, knee bending, toes just leaving the ground. Lowest body position (head about 7 px lower than in W08).
W12 PASSING: The FAR leg is straight and vertical under the body, foot flat, carrying all the weight. The NEAR leg (closest to the viewer, drawn in front) passes it with the knee bent and pointing forward and the foot lifted a little above the floor. Arms close to the sides.
W14 UP: The FAR leg is behind the body pushing off, heel lifted, only the front of the foot on the floor. The NEAR leg swings forward, knee almost straight, foot just above the floor about to land. Highest body position.
```

Save each accepted key as `out/2-keys/W00.png` (and so on). Keep rejected attempts in `out/2-keys/attempts/`.

When all 8 keys exist, make two review files:
- `out/2-keys/contact-sheet.png`: the 8 keys in a row, in time order W00 W02 … W14.
- `out/2-keys/preview.gif`: the keys in time order at 8 fps, looping, with green turned to white.

Then stop.

## Stage 2b: key corrections (after review)

The 8 keys were keyed, registered and measured. Heads were aligned by silhouette; the head-overlap IoU was 0.98–0.99 and the scale was consistent. Identity, style and the open hands are **approved**: keep everything about the character exactly as it is.

What's wrong is the vertical **body bob** and two poses. The table compares the measured height of the top of the head against W00, with the soles on the floor:

| Frame | Now (vs W00) | Target | Problem |
|---|---|---|---|
| W02 DOWN | 1 px higher | **7 px lower** | Support knee is almost straight, so there is no "down" accent on this step (W10 has one) |
| W06 UP | 2 px higher | **12 px higher** | Front foot is already planted on the floor, so the drawing reads as a second contact pose. It must still be in the air |
| W08 CONTACT | 7 px lower | **same as W00** | Stride is wider than W00, so the body sinks; the two steps look like a limp |
| W14 UP | same | **12 px higher** | Same as W06: front foot already planted |

W00, W04, W10 and W12 are accepted. **Do not redraw them.**

Redraw only W02, W06, W08 and W14. Keep each current file as `out/2-keys/attempts/Wxx-v1.png` before replacing it.

**References, in order:**
1. `refs/walk-base.png`
2. the frame's guide
3. `out/2-keys/W00.png`: identity, rendering and the height and stride reference
4. the previous key in time
5. the next key in time

The previous and next keys are: W02 → W00 and W04; W06 → W04 and W08; W08 → W06 (use the new one) and W10; W14 → W12 and W00.

Generate in this order: **W06, W14, W08, W02**.

**Prompt template** (same `[CHARACTER]` and `[TECH]` blocks as before):
```text
Use case: professional 2D hand-drawn animation key drawing, identity-locked correction.
Reference 1 is the approved three-quarter-right model; reference 3 is an approved frame of this same walk (W00) and the exact standard for face, hair, costume, rendering, head size, skirt length and stocking thickness. Reference 2 is the pose diagram for this frame (diagram only; dark blue = NEAR leg/arm, light blue = FAR leg/arm, black = floor). References 4 and 5 are the approved drawings just BEFORE and just AFTER this frame in time: this drawing must sit naturally between them.
Draw frame <FRAME> of the walk toward screen RIGHT, same three-quarter view, not mirrored.
<POSE>
Keep the upper body, head, face, arms style and costume identical to reference 3; only the legs, the body height, the arm swing, and the follow-through of skirt, hair and tail change. Exactly two complete legs and two complete socked feet.
[CHARACTER]
[TECH]
```

**`<POSE>` for each frame:**
```text
W06 UP (highest point of the step): The NEAR leg is behind the body, almost straight, and stands ONLY on the ball and toes of its foot; its heel is lifted well off the floor (about 60-80 px). The FAR leg swings forward with the knee slightly bent and the ENTIRE foot IN THE AIR, toes pointing forward and a little down, its lowest point about 50-70 px above the floor. It has NOT landed yet (it lands in the next frame, reference 5). Because the body is raised on the back toes, the top of the headband is about 12 px HIGHER than in reference 3. Near arm slightly forward, far arm slightly back.
W14 UP (highest point of the step): The FAR leg is behind the body, almost straight, standing ONLY on the ball and toes of its foot; its heel is lifted well off the floor (about 60-80 px). The NEAR leg (closest to the viewer) swings forward with the knee slightly bent and the ENTIRE foot IN THE AIR, toes pointing forward and a little down, its lowest point about 50-70 px above the floor. It has NOT landed yet (it lands in the next frame, reference 5). The top of the headband is about 12 px HIGHER than in reference 3. Near arm slightly back, far arm slightly forward.
W08 CONTACT: Exactly like reference 3 (W00) with the legs swapped. The FAR leg has just stepped forward, almost straight, heel touching the floor with the toes raised; the NEAR leg is extended behind, only its toes on the floor. The distance between the two feet is the SAME as in reference 3 (not wider), so the top of the headband is at the SAME height as in reference 3.
W02 DOWN (lowest point of the step): Weight drops onto the NEAR leg, which is under the body slightly forward with the knee clearly BENT (visibly more than in reference 3) and the foot flat. The FAR leg behind is peeling off the floor, knee bent, toes just leaving the ground. The whole body sinks: the top of the headband is about 7 px LOWER than in reference 3.
```

Then remake `out/2-keys/contact-sheet.png` and `out/2-keys/preview.gif`, and stop. The user will send the result back for measuring.

> **Correction to Stage 2b (W08):** W08's stride being about 25% wider than W00's is *correct*. In this three-quarter view the far hip is drawn ahead of the near hip, so when the far leg is in front the feet look further apart. The guide measures exactly the same ratio. The current W08 is accepted as is.

## Stage 2c: where the feet stand (after the second review)

The bob is no longer the issue. The build script now fine-tunes body height by up to ±17 px, so heights are **not** a target in this stage.

The problem is **where the feet are horizontally**. During one step the supporting foot is planted on the floor, so in the drawings it must slide backward at a steady rate, about 105 px per key. Measured in the current keys (x of the tip of the supporting foot's toes):

| Supporting foot | contact | down | passing | up | contact |
|---|---|---|---|---|---|
| near (W00→W08) | 727 | W02 610 ✓ | **W04 584**, want ≈520 | **W06 315**, want ≈415 | 310 ✓ |
| far (W08→W00) | 790 | **W10 591**, want ≈677 | W12 585 ✓ | **W14 347**, want ≈457 | 351 ✓ |

The foot barely moves for one key and then jumps 230–270 px. In the app this makes her either lurch forward or skate on the floor.

- **W06 and W14** have the legs spread far too wide: they read as "about to land", not "up".
- **W04's** support foot is half a foot too far forward; it should sit a little behind the hips.
- **W10's** support foot is too far back; it should be planted in front of the hips, like W02.

W00, W02, W08 and W12 are accepted. **Redraw only W04, W06, W10 and W14.** Keep each current file as `out/2-keys/attempts/Wxx-v2.png` before replacing it.

**Measuring tool:** run `python tools/feet_check.py <png>` on every try. It prints the measured positions and `"pass"`. A try is acceptable only when it passes **and** the visual checks pass. Run it once on the current files first; it must report W04 stance_toe 584, W06 315, W10 591 and W14 347. Up to **6 tries** per frame. If none passes, keep the try with the lowest `"score"` that is visually correct.

| Frame | Support foot (only foot on the floor) | Toe tip of support foot | Other foot |
|---|---|---|---|
| W04 | NEAR, flat | x 500–540 | lifted, behind or beside the support foot |
| W06 | NEAR, on its toes (heel up) | x 395–435 | FAR foot in the air ahead: toe tip x 670–740, lowest point 20–55 px above the floor |
| W10 | FAR, flat | x 657–697 | lifted behind, toes just off the floor |
| W14 | FAR, on its toes (heel up) | x 437–477 | NEAR foot in the air ahead: toe tip x 630–700, lowest point 20–55 px above the floor |

For orientation: the guide's dashed centre line is x = 512, and one foot is about 125 px long.

**References, in order (at most five):**

| Frame | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| W04 | `refs/walk-base.png` | `guides/guide-W04.png` | `out/2-keys/W00.png` | `out/2-keys/W02.png` (previous) | `out/2-keys/W12.png` (same moment, other step) |
| W10 | `refs/walk-base.png` | `guides/guide-W10.png` | `out/2-keys/W00.png` | `out/2-keys/W08.png` (previous) | `out/2-keys/W02.png` (same moment, other step) |
| W06 | `refs/walk-base.png` | `guides/guide-W06.png` | `out/2-keys/W00.png` | new `out/2-keys/W04.png` (previous) | `out/2-keys/W08.png` (next) |
| W14 | `refs/walk-base.png` | `guides/guide-W14.png` | `out/2-keys/W00.png` | `out/2-keys/W12.png` (previous) | new `out/2-keys/W06.png` (same moment, other step) |

Generate in this order: **W04, W10, W06, W14**.

**Prompt template** (same `[CHARACTER]` and `[TECH]` blocks):
```text
Use case: professional 2D hand-drawn animation key drawing, identity-locked correction of the legs.
Reference 1 is the approved three-quarter-right model. Reference 3 (W00) is an approved frame of this walk and the exact standard for face, hair, costume, rendering, head size, skirt length and stocking thickness. Reference 2 is the pose diagram (diagram only; dark blue = NEAR leg/arm, light blue = FAR leg/arm, black = floor, dashed vertical line = the hips' centre line). Reference 4 is the approved drawing just before this one in time. Reference 5 is named in the pose text.
Draw frame <FRAME> of the walk toward screen RIGHT, same three-quarter view, not mirrored. Keep the head, face, upper body, arms and costume identical in style and size to reference 3, and keep the head at the same place on the canvas. What changes is WHERE THE FEET STAND: follow the horizontal foot positions below precisely.
<POSE>
Exactly two complete legs and two complete socked feet; where the legs overlap, the far leg is partly hidden behind the near leg.
[CHARACTER]
[TECH]
```

**`<POSE>` for each frame:**
```text
W04 PASSING: The NEAR leg is the supporting leg: straight, the whole foot FLAT on the floor, and the foot stands a little BEHIND the hips. The tip of its toes is right at the dashed centre line and the heel is about one foot-length behind it (the leg slants slightly backward from hip to foot). The FAR leg passes behind/beside it with the knee bent and pointing forward, its foot clearly lifted off the floor (40-90 px). Reference 5 (W12) is the same moment of the other step: copy how far behind the hips its supporting foot stands.
W10 DOWN: Weight drops onto the FAR leg, which is planted IN FRONT of the hips: the whole foot flat on the floor, the heel just ahead of the dashed centre line and the toes about 1.3 foot-lengths ahead of it; knee softly bent. The NEAR leg behind is peeling off the floor, knee bent, toes just off the ground, at about the same place as in reference 4's back foot. Reference 5 (W02) is the same moment of the other step: copy how its supporting foot is planted in front of the hips.
W06 UP: The two feet are CLOSE together, a narrow stance, much narrower than the contact pose in reference 5. The NEAR leg is just behind the hips, almost straight, standing only on the ball and toes, heel lifted; the tip of its toes is less than one foot-length behind the dashed centre line. The FAR leg swings forward, knee slightly bent, the whole foot IN THE AIR and low (20-55 px above the floor), its toes about 1.5 foot-lengths ahead of the centre line. It has not landed yet: it lands in reference 5, slightly further forward than it is now.
W14 UP: The two feet are CLOSE together, a narrow stance. The FAR leg is just behind the hips, almost straight, standing only on the ball and toes, heel lifted; the tip of its toes is about half a foot-length behind the dashed centre line. The NEAR leg (closest to the viewer) swings forward, knee slightly bent, the whole foot IN THE AIR and low (20-55 px above the floor), its toes about 1.2 foot-lengths ahead of the centre line. Reference 5 (W06) is the same moment of the other step: match its narrow stance.
```

**Notes:**
- The border-green check (self-check 1) is information only in this stage. Any flat green background keys cleanly, so don't spend tries on it.
- Leg identity still matters most. A try with the wrong leg in front, or with legs swapped or merged, is rejected even if it passes the measurements.

Then remake `out/2-keys/contact-sheet.png` and `out/2-keys/preview.gif`, write `out/2-keys/stage2c/REPORT.md` with the `feet_check.py` output of the final eight keys, and stop.

## Stage 3: the 8 in-betweens

**Status:** all 8 keys in `out/2-keys/` are approved as they are, after the Stage 2c review. The four redrawn keys pass `feet_check.py`, leg identity is correct in every key, and the supporting foot now moves back steadily through each step. **Do not redraw any key.**

For each odd frame `Wn` (W01, W03 … W15), the neighbours are the keys `W(n-1)` and `W(n+1)`. W15 sits between W14 and W00.

**What the in-betweens must get right:**
- **The supporting foot** stays planted. It must be drawn exactly halfway between where it stands in the two neighbouring keys. `tools/feet_check.py` now includes these targets.
- **The swing foot** in W07 and W15 is still IN THE AIR, low, just before it lands. A planted front foot there would show as a skate in the app.
- **Leg identity.** The same leg is in front and supporting as in both neighbours.

Body height (bob) is **not** a target: the build adjusts it. Ignore the border-green check as in Stage 2c.

**Measuring tool:** run `python tools/feet_check.py out/3-inbetweens/Wn.png` (or the attempt file) on every try. A try is acceptable only when it passes **and** the visual checks pass. Up to **6 tries** per frame. If none passes, keep the try with the lowest `"score"` that is visually correct.

| Frame | Between | Supporting foot | Measured target | Other foot |
|---|---|---|---|---|
| W01 | W00 → W02 | NEAR, in front, heel down, foot rolling flat | heel x 524–564 | FAR behind, toes leaving the floor (may still just touch) |
| W03 | W02 → W04 | NEAR, flat under the body | toe x 543–583 | FAR lifted behind, knee bent, swinging forward |
| W05 | W04 → W06 | NEAR, flat (heel may just start to rise) | toe x 451–491 | FAR swinging past the near leg, foot lifted |
| W07 | W06 → W08 | NEAR, behind, on its toes | toe x 349–389 | FAR in the air ahead, about to land: toe x 740–780, lowest point 14–45 px up |
| W09 | W08 → W10 | FAR, in front, heel down, foot rolling flat | heel x 581–621 | NEAR behind, toes leaving the floor (may still just touch) |
| W11 | W10 → W12 | FAR, flat under the body | toe x 612–652 | NEAR lifted behind, knee bent, swinging forward (drawn in front) |
| W13 | W12 → W14 | FAR, flat (heel may just start to rise) | toe x 510–550 | NEAR swinging past the far leg, foot lifted (drawn in front) |
| W15 | W14 → W00 | FAR, behind, on its toes | toe x 392–432 | NEAR in the air ahead, about to land: toe x 682–722, lowest point 14–45 px up |

**References, in order:**
1. `out/2-keys/W(n-1).png` (the key just before)
2. `out/2-keys/W(n+1).png` (the key just after)
3. `guides/guide-Wn.png`
4. `refs/walk-base.png`
5. `out/2-keys/W00.png` (rendering standard; for W01 use `out/2-keys/W04.png` instead, since W00 is already reference 1)

Generate in this order: **W03, W11, W05, W13, W01, W09, W07, W15**.

**Prompt template** (replace `<FRAME>` and `<POSE>`):
```text
Use case: 2D hand-drawn animation in-between (breakdown) drawing, identity-locked.
References 1 and 2 are two consecutive approved key drawings of the same walk cycle toward screen RIGHT. Draw the drawing exactly HALFWAY between them in time. Reference 3 is the pose diagram for this halfway pose (diagram only; dark blue = NEAR leg/arm, light blue = FAR leg/arm, black = floor, dashed vertical line = the hips' centre line). Reference 4 is the identity model; reference 5 is an approved frame of this walk and the standard for rendering, head size, skirt length and stocking thickness.
Draw frame <FRAME>, same three-quarter view as the references, not mirrored.
<POSE>
Every moving part sits midway between its positions in reference 1 and reference 2: thighs, shins, feet, arms, hands, skirt hem, apron frills, hair tips, ears and tail. The head stays at the same place on the canvas, and the head, face, hair top, costume, colours, line quality and proportions stay IDENTICAL to references 1 and 2. It must be one clean, complete drawing, not a blend or double exposure: exactly two legs, two socked feet and two hands, all intact; where the legs overlap, the far leg is partly hidden behind the near leg.
[CHARACTER]
[TECH]
```

**`<POSE>` for each frame:**
```text
W01: The NEAR leg is in front, almost straight, its heel on the floor and the foot rolling down so the toes are only slightly raised (flatter than in reference 1). Its heel stands where it was in reference 1, moved back by half the distance to its heel in reference 2. The weight is moving onto it. The FAR leg is behind, heel high, toes just leaving the floor. Arms halfway between references 1 and 2.
W03: The NEAR leg carries the weight under the body, foot FLAT, knee softening less than in reference 1. The tip of its toes is halfway between where they are in reference 1 and in reference 2. The FAR leg is behind, knee bent, foot lifted well off the floor, starting to swing forward. Arms halfway.
W05: The NEAR leg is straight and slightly behind the hips, foot flat (the heel may just begin to lift). The tip of its toes is halfway between references 1 and 2. The FAR leg swings forward past the near leg, knee bent and leading, foot lifted clear of the floor. Arms halfway.
W07: The NEAR leg is behind the body, standing ONLY on the ball and toes, heel lifted high; the tip of its toes is halfway between references 1 and 2. The FAR leg reaches forward, almost straight, its WHOLE foot still IN THE AIR, low, toes slightly raised. It is about to land: it lands in reference 2, a little further forward. Arms halfway.
W09: The FAR leg is in front, almost straight, its heel on the floor and the foot rolling down so the toes are only slightly raised. Its heel stands where it was in reference 1, moved back by half the distance to its heel in reference 2. The NEAR leg is behind, heel high, toes just leaving the floor. Arms halfway.
W11: The FAR leg carries the weight under the body, foot FLAT. The tip of its toes is halfway between references 1 and 2. The NEAR leg (closest to the viewer, drawn in front) is behind the body, knee bent, foot lifted well off the floor, starting to swing forward. Arms halfway.
W13: The FAR leg is straight and slightly behind the hips, foot flat (the heel may just begin to lift). The tip of its toes is halfway between references 1 and 2. The NEAR leg (drawn in front) swings forward past it, knee bent and leading, foot lifted clear of the floor. Arms halfway.
W15: The FAR leg is behind the body, standing ONLY on the ball and toes, heel lifted high; the tip of its toes is halfway between references 1 and 2. The NEAR leg (drawn in front) reaches forward, almost straight, its WHOLE foot still IN THE AIR, low, toes slightly raised. It is about to land: it lands in reference 2, a little further forward. Arms halfway.
```

Save each accepted drawing as `out/3-inbetweens/Wn.png` and every try as `out/3-inbetweens/attempts/Wn-try-N.png`. Then:
- make `out/3-inbetweens/contact-sheet.png`: all 16 frames W00 … W15 in time order, two rows of 8;
- make `out/3-inbetweens/preview.gif`: the 16 frames at 14 fps, looping, green turned to white;
- write `out/3-inbetweens/REPORT.md` with the `feet_check.py` output of all 16 frames, and the retries per frame.

Then stop.

## Stage 3b: the swinging foot in W05 and W13

The full 16-frame walk is in the app. It is approved, including the arm fix. The only remaining problem is the **timing of the swinging foot** in W05 and W13. The table shows the front-most point of the lifted foot (`swing_tip` below) in the current files:

| Step | before | in-between | after | Movement per frame |
|---|---|---|---|---|
| far foot swings | W04: 531 | **W05: 574** | W06: 734 | 43, then **160** |
| near foot swings | W12: about 433 (foot behind) | **W13: 613** | W14: 662 | **180**, then 49 |

In W05 the foot hangs back and then snaps forward to W06 in a single frame. In W13 it snaps forward one frame too early. Each in-between should hold the foot halfway: **W05 ≈ 632, W13 ≈ 548**.

**Redraw only W05 and W13.** Keep the current files as `out/3-inbetweens/attempts/W05-before-3b.png` and `W13-before-3b.png` before replacing them. Do not change any other frame; the official files are `out/2-keys/` and `out/3-inbetweens/`.

Everything in these two drawings stays as it is: face, hair, ears, the arms and hands (just fixed), blouse, skirt, apron, tail, and the supporting leg with its foot on the floor. **Only the swinging leg moves.**

**Measuring tool:** `python tools/feet_check.py <png>` now also measures `swing_tip`. That is the right-most character pixel between 50 and 160 px above the floor: the toes of a lifted foot that is ahead of the supporting shin. Run it on every try. It must first report W05 `swing_tip` 574 and W13 613 on the current files. A try is acceptable only when it passes **and** the visual checks pass (leg identity, two complete legs and feet, arms unchanged). Up to **6 tries** per frame. If none passes, keep the try with the lowest `"score"` that is visually correct.

| Frame | Supporting foot (unchanged) | Swinging foot |
|---|---|---|
| W05 | NEAR, toe x 451–491 | FAR: `swing_tip` x 612–652, lowest point 55–100 px above the floor |
| W13 | FAR, toe x 510–550 | NEAR: `swing_tip` x 528–568, i.e. its toes just ahead of the supporting toes; lifted about 50–80 px (not measured) |

**References, in order:**
1. the current drawing: `out/3-inbetweens/W05.png` (or `W13.png`)
2. the key just before: `out/2-keys/W04.png` (or `W12.png`)
3. the key just after: `out/2-keys/W06.png` (or `W14.png`)
4. `guides/guide-W05.png` (or `guide-W13.png`)
5. `refs/walk-base.png`

Generate **W05** first, then **W13**.

**Prompt template** (same `[CHARACTER]` and `[TECH]` blocks):
```text
Use case: 2D hand-drawn animation in-between, correction of ONE leg, identity-locked.
Reference 1 is the current version of this drawing: keep EVERYTHING in it exactly as it is (head, face, hair, ears, arms, hands, blouse, skirt, apron, tail, and the supporting leg with its foot on the floor). The only change is the position of the swinging leg described below. References 2 and 3 are the approved drawings just before and just after this one in time. Reference 4 is the pose diagram (diagram only; dark blue = NEAR leg/arm, light blue = FAR leg/arm, black = floor, dashed vertical line = the hips' centre line); where it differs from the foot positions below, follow the text. Reference 5 is the identity model.
Draw frame <FRAME> of the walk toward screen RIGHT, same three-quarter view, not mirrored.
<POSE>
Exactly two complete legs and two complete socked feet; where the legs overlap, the far leg is partly hidden behind the near leg.
[CHARACTER]
[TECH]
```

**`<POSE>` for each frame:**
```text
W05: The NEAR leg stays exactly as in reference 1: straight, carrying the weight, the foot flat on the floor. The FAR leg (partly hidden behind the near leg) is swinging forward and must be FURTHER FORWARD than in reference 1, halfway between reference 2 (foot under the body) and reference 3 (foot reaching forward). Its thigh points forward, the knee is bent and in front of the hips, and the shin hangs down and slightly forward. The WHOLE foot is in the air, a little lower than in reference 1 (its lowest point about 55-100 px above the floor), with its toes about one foot-length (about 150 px) ahead of the near foot's toes.
W13: The FAR leg stays exactly as in reference 1: carrying the weight, the foot flat on the floor. The NEAR leg (closest to the viewer, drawn in front of the far leg) is swinging forward but must be FURTHER BACK than in reference 1, halfway between reference 2 (foot behind, lifted) and reference 3 (foot reaching forward). It is just passing the supporting leg: knee bent and pointing forward, the shin hanging almost straight down under the knee, the WHOLE foot in the air about 50-80 px above the floor. Its toes are only slightly (about 20 px) ahead of the supporting foot's toes, so the two feet are side by side with the near one lifted and drawn in front.
```

Then remake `out/3-inbetweens/contact-sheet.png` (16 frames, two rows of 8) and `out/3-inbetweens/preview.gif` (16 frames at 14 fps, looping, green turned to white). Write `out/3-inbetweens/stage3b/REPORT.md` with the `feet_check.py` output of all 16 frames and the retries per frame, and stop.

## Stage 4: the start and stop turn (T1, T2)

> **Done, v2 (2026-11-11).** This stage was redone with a different method, described in `out/4-turn/REPORT.md`; the first version is kept in `out/4-turn/v1/`. What is in the app now:
> - **Three in-betweens per direction:** `T1`, `T2`, `T3` for the turn to the right and `T1L`, `T2L`, `T3L` for the turn to the left. The left turn is drawn on its own (not mirrored), so the bows and the tail stay on the same side as in the standing art.
> - **Every drawing is an edit of its neighbour, not a fresh drawing:**
>   - T1 is an edit of `refs/stand-green.png` (the standing art on the green canvas).
>   - T3 is an edit of `refs/walk-base.png` (left: `refs/walk-base-left.png`, the walk model mirrored).
>   - T2 is an edit of T1, with T3 attached as the target.
> - **Positions are the build's job:** `scripts/walk-build.mjs` steps the height and corrects the horizontal position itself, so the `eyes_x` / feet targets below are guidance only.
>
> The text below is the original v1 brief. Rerun this stage only to replace a drawing, and keep the new tries under new names.

**Status:** the 16-frame walk is approved and in the app. **Do not change any W frame.** The build now matches every frame's colours to the standing art automatically (lightness, saturation, the pink cast in white hair and stockings, the outline). Colour and brightness are therefore **not** a target in this stage. Don't spend tries on them.

**What this is for:** when she starts walking, the pet still cross-fades from the front-facing standing art straight into the three-quarter walk. Two in-between drawings turn that into a short turn on the spot:

standing art → **T1** → **T2** → walk model (`refs/walk-base.png`) → walk.

Stopping plays the same drawings backwards. Each one is on screen for about 0.1 s.

**She turns in place:**
- The feet stay on the same spot of the floor. Both soles are on the ground line, under the middle of the canvas.
- The head leads the turn a little; the shoulders and then the hips follow. The head stays at the same height.
- Because the face is in front of the turning axis, the face moves to the right as she turns. The feet do not.

| | Face (`eyes_x`) | Feet, bottom 40 rows (`feet_left` – `feet_right`) |
|---|---|---|
| Start: standing art placed on this canvas (`refs/scale-reference.png`) | 499 | 439 – 655 (screen-right foot on its toes) |
| **T1**, one third of the way | **508 – 526** | **420 – 455** to **600 – 650** |
| **T2**, two thirds of the way | **525 – 543** | **420 – 455** to **580 – 630** |
| End: `refs/walk-base.png` | 550 | 429 – 587 (feet together) |

The height is the same as in every walk frame: self-check 3 (bounding-box height within ±2.5% of `refs/walk-base.png`) applies.

**Details that must change smoothly across T1 and T2:**
- **Hands.** In the standing art both hands hold the skirt hem at her sides. In the walk model the arms hang relaxed with soft open hands. T1 is letting go; T2 is almost relaxed.
- **Legs.** In the standing art the knees are together and the screen-right foot rests on its toes. In the walk model the legs are straight and the feet are together and flat. In both T1 and T2 both soles are flat on the floor.
- **Ear bows.** In the standing art the two tiny bows are on the ear at screen RIGHT. In the walk model they are on the ear nearer the viewer, at screen LEFT. **T1 keeps them on the screen-right ear; T2 has them like the walk model.** This overrides the bow note in [CHARACTER] for T1.
- **Tail.** In the standing art it peeks out at screen right. In the walk model it peeks out at screen left behind the skirt. T1: a small tip at the right, or hidden. T2: at the left, like the walk model.

**Measuring tool:** `python tools/feet_check.py` now also prints `eyes_x` (the centre of the violet iris pixels), `feet_left` and `feet_right`, and it has T1 and T2 targets.
- Run it on `refs/walk-base.png` first. It must print `eyes_x` 550, `feet_left` 429 and `feet_right` 587. `scale-reference.png` has a white background, so the tool can't measure it; its values are in the table.
- Run it on every try. A try is acceptable only when it passes **and** the visual checks pass.
- Up to **6 tries** per drawing. If none passes, keep the try with the lowest `"score"` that is visually correct.
- Name tries `out/4-turn/attempts/T1-try-N.png` so the tool picks the right targets.

**References, in order:**

| Drawing | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| T1 | `refs/scale-reference.png` (start) | `refs/walk-base.png` (end) | `refs/ich01A_101.png` | none |
| T2 | `refs/scale-reference.png` (start) | `refs/walk-base.png` (end) | `refs/ich01A_101.png` | `out/4-turn/T1.png` (the approved T1) |

Generate **T1** first, then **T2**.

In [TECH], ignore the mention of the pose guide (there is none for this stage). Place her like references 1 and 2: soles on y = 1480, top of the headband at about y = 80, about 1400 px tall, feet under the middle of the canvas.

**Prompt template** (replace `<FRAME>`, `<WHERE>`, `<REF4>` and `<POSE>`):
```text
Use case: 2D hand-drawn animation, turn in-between, identity-locked.
Reference 1 is the START pose: this character standing facing the viewer, already placed on the target canvas (its white background, grey dashed centre line and dark ground line are a placement diagram only, never draw them). Reference 2 is the END pose: the approved walk model, the same girl standing in a three-quarter view turned toward screen RIGHT on the same canvas; it is also the standard for rendering, line quality, head size and proportions. Reference 3 is the design source of truth for her face, ears, hair and costume.<REF4>
Draw <FRAME>: she turns on the spot from reference 1 to reference 2, getting ready to walk to the right. This drawing is <WHERE> of the way through the turn.
<POSE>
She turns in place: both feet stay on the same spot of the floor under the middle of the canvas with both soles on the ground line; the head leads the turn a little and the shoulders and hips follow; the head stays at the same height as in references 1 and 2. Same calm, sweet closed-mouth smile. One complete, clean drawing at this in-between angle, never a blend or double exposure of the references: exactly one face, two arms, two hands, two legs and two socked feet.
[CHARACTER]
[TECH]
```

`<REF4>` is empty for T1. For T2 it is: ` Reference 4 is the approved drawing T1, one third of the way through this same turn: continue the motion from it and keep its rendering.`

**`<WHERE>` and `<POSE>` for each drawing:**
```text
T1 — <WHERE> = ONE THIRD
Her head is turned about 15 degrees toward screen right and her violet eyes have begun to look to the right; the whole face, both eyes and both floppy dog ears are still clearly visible, and the right half of her face is a little narrower than in reference 1. Shoulders and chest are turned about 10 degrees, hips about 8 degrees. Her hands are letting go of the skirt hem: still at her sides near the hem, fingers relaxing and opening, the hem settling. Legs nearly straight and close together; the foot that rests on its toes in reference 1 (screen right) has come down, so both soles are flat on the ground line, a little apart. The two tiny bows (navy and peach) are still on the ear on the screen-RIGHT side, exactly where they are in reference 1. The tail shows only as a small tip at the right edge of the skirt, or is hidden.

T2 — <WHERE> = TWO THIRDS
She is already close to reference 2. Her head is turned about 30 degrees toward screen right, gaze to the right; both eyes are visible, the far eye a little narrower. Shoulders and chest are turned about 25 degrees, hips about 22 degrees. Both arms hang down relaxed, nearly as in reference 2, with soft open hands: the hand nearer the viewer lightly beside the front of the skirt, the far hand at the far side. Feet together, side by side and flat, nearly as in reference 2. The two tiny bows are on the ear nearer the viewer (screen left), as in reference 2. The tail peeks out from behind the skirt on the left side, as in reference 2.
```

Save the accepted drawings as `out/4-turn/T1.png` and `out/4-turn/T2.png`. Then:
- make `out/4-turn/contact-sheet.png`: `refs/scale-reference.png`, T1, T2 and `refs/walk-base.png` in a row, green turned to white;
- make `out/4-turn/preview.gif` at 10 fps, looping, green turned to white: scale-reference → T1 → T2 → walk-base, hold 0.5 s, then back walk-base → T2 → T1 → scale-reference, hold 0.5 s;
- write `out/4-turn/REPORT.md` with the `feet_check.py` output of T1, T2 and every try, which side the bows and the tail are on in each drawing, and anything you are not fully satisfied with.

Then stop.

## Self-check after EVERY image (regenerate on failure, up to 4 tries; keep the best)

Use a short Python + Pillow script for the measurable checks, then look at the image yourself.

1. **Canvas and background.** The image is 1024×1536. At least 99% of the pixels along the outer 20 px border are pure #00FF00 (±8 per channel).
2. **Placement.**
   - Treat as "character" any pixel that is NOT green (G − max(R, B) < 60).
   - The lowest character row is between 1468 and 1492.
   - The top character row is between 40 and 110.
   - The horizontal centre of the pixels between rows 900 and 1000 (hips and skirt) is within 512 ± 60.
3. **Consistency (stages 2, 3 and 4).** The character's bounding-box height is within ±2.5% of `refs/walk-base.png`, measured the same way.
4. **Visual check.** Compare against the guide and `ich01A_101.png`:
   - correct leg is forward;
   - exactly two legs, two feet and two hands, no fused or missing limbs;
   - same face, eye colour and ear shape;
   - floppy dog ears, no shoes, no toe lines;
   - no mannequin colours, lines or text copied from the guide;
   - no green fringe painted on the character.

**Report at the end of each stage:**
- the saved files;
- which frames needed retries;
- any frame you are not fully satisfied with, and why.
