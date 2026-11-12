# Stage 4 report, v2: the start and stop turn

Regenerated on 2026-11-11 with Codex's built-in image tool (edit mode), to make the whole turn as continuous and consistent as possible. The first version (two drawings, the left turn mirrored) is kept in `v1/`.

## What changed from v1

| | v1 | v2 |
|---|---|---|
| In-betweens per direction | 2 | **3** (T1, T2, T3) |
| How each drawing was made | Drawn fresh from the start and end references | **An edit of its neighbour.** T1 edits the standing art, T3 edits the walk model, and T2 edits T1 with T3 as the target. Line, colour and placement carry over from frame to frame. |
| Head motion (right turn, as shown) | 500 → 551 in the first drawing, then 559, overshooting the walk model's 549 | 500 → 527 → 537 → 548 → 549, without overshoot |
| Horizontal placement | Least-squares fit of feet and face toward a straight line (moved drawings by up to 30 px) | Image registration of neighbouring drawings (moves drawings by at most 14 px) |
| Turn to the left | The right turn mirrored, so the bows jumped ears twice | **Drawn separately** (T1L–T3L), so the bows stay on the screen-right ear and the tail stays at the right throughout, as in the standing art and the mirrored walk |
| Length | 0.26 s | 0.29 s (holds 0.085 / 0.075 / 0.07 / 0.06 s) |

## How the drawings were made

All six drawings are edits. Image 1 is the image being edited, and the prompt says to keep everything that is not listed as changing.

| Drawing | Edited image | Also attached | Change asked for |
|---|---|---|---|
| T1 | `refs/stand-green.png` (standing art on the green canvas) | walk model, design sheet | Head 12° to the right, body 8°/5°; hands let go of the hem; the tiptoe foot comes down; bows and tail unchanged |
| T3 | `refs/walk-base.png` | standing art, T1, design sheet | Turn back about 25°/20°; feet slightly apart; bows and tail as in the walk model |
| T2 | T1 | T3, design sheet | Exactly halfway between T1 and T3, part by part; tail hidden |
| T1L | `refs/stand-green.png` | `refs/walk-base-left.png`, design sheet | As T1, toward screen left |
| T3L | `refs/walk-base-left.png` | standing art, T1L, design sheet | As T3, toward screen left |
| T2L | T1L | T3L, design sheet | Halfway between T1L and T3L |

`refs/walk-base-left.png` is the walk model mirrored. Its bows (screen-right ear) and tail (right) match the standing art. That is why the left turn needs no ear swap.

## Accepted drawings

| Drawing | Source | Why |
|---|---|---|
| `T1.png` | `attempts/T1-try-5.png` | Head turned only slightly (eyes 529), hands opening at the hem, both soles flat, rendering identical to the standing art |
| `T2.png` | `attempts/Tmid-try-1.png` | Closest to the true midpoint of T1 and T3: pixel difference 11.9 against the T1/T3 average, against 13.0 and 13.6 for the other tries, and equally far from both neighbours |
| `T3.png` | `attempts/T2-try-4.png` | Face 548 against 550 for the walk model; feet slightly apart, between T2 and the walk model |
| `T1L.png` | `attempts/T1L-try-3.png` | Cleanest face; feet and hands mirror T1 |
| `T2L.png` | `attempts/TmidL-try-2.png` | Best midpoint after the build's horizontal registration (11.9 against 12.5 and 12.6), and equally far from T1L and T3L |
| `T3L.png` | `attempts/T2L-try-1.png` | Face 474, the same as the mirrored walk model |

The `T2-try-*` / `T2L-try-*` files are the drawings now called T3/T3L: they were generated before the middle drawing existed.

## Measurements (`feet_check` logic, JS port, on the drawings as delivered)

The pass/fail columns of `feet_check` use the v1 targets for a right turn, so they are left out here.

| File | eyes_x | feet (bottom 40 rows) |
|---|---|---|
| standing art (start) | 500 | 437-654 |
| T1-try-4 | 529 | 435-610 |
| **T1-try-5 → T1** | 529 | 431-604 |
| T1-try-6 | 527 | 429-595 |
| **Tmid-try-1 → T2** | 537 | 419-625 |
| Tmid-try-2 | 542 | 422-625 |
| Tmid-try-3 | 537 | 418-623 |
| **T2-try-4 → T3** | 548 | 412-630 |
| T2-try-5 | 551 | 421-621 |
| T2-try-6 | 547 | 417-621 |
| walk-base (end) | 550 | 429-587 |
| | | |
| T1L-try-1 | 469 | 427-597 |
| T1L-try-2 | 468 | 432-594 |
| **T1L-try-3 → T1L** | 471 | 429-596 |
| TmidL-try-1 | 465 | 397-605 |
| **TmidL-try-2 → T2L** | 459 | 398-601 |
| TmidL-try-3 | 458 | 396-604 |
| **T2L-try-1 → T3L** | 474 | 395-610 |
| T2L-try-2 | 469 | 386-608 |
| T2L-try-3 | 474 | 375-602 |
| walk-base-left (end) | 474 | 437-595 |

## What the build does with them (`scripts/walk-build.mjs`)

- **Height** is stepped from the standing art to the walk's passing frames: 1397 → 1392 → 1387 → 1382 → 1377 → 1372 px. The head never dips when the first step starts.
- **x: image registration.** This replaces v1's least-squares fit of feet and face. Each pair of neighbours (standing art → T1 → T2 → T3 → walk model) is aligned by its best overlap at half size. The two ends stay where they are. What is left over is spread over the steps, mostly over the pairs whose overlap is least certain. Because every drawing was made by editing its neighbour, the drawings were already almost in place:
  - right turn: neighbour offsets +1.8, +2.5, +0.6, −0.6 px, leftover 4.4 px; shifts applied T1 −1.5, T2 +0.5, T3 +1.0 px;
  - left turn: neighbour offsets +0.5, −4.1, +14.2, +2.5 px, leftover 13.0 px; shifts applied T1L +5, T2L +14, T3L +2 px. T2L is the drawing that came out a little too far round.

  For comparison, v1's method would have moved these drawings by +7/−1/−6 px and +24/+30/+15 px. That pulled the face off its path and slid the planted foot.
- **Colours** are matched to the standing art like the walk frames.

Path as the app shows it (canvas px; the pet shows them at about 1/4 size):

| | Standing art | T1 | T2 | T3 | Walk model |
|---|---|---|---|---|---|
| Right: face | 500 | 527 | 537 | 548 | 549 |
| Right: feet | 437-654 (tiptoe) | 429-602 | 420-625 | 414-630 | 430-586 |
| Left: face | 500 | 476 | 473 | 477 | 475 |
| Left: feet | 437-654 (tiptoe) | 434-601 | 413-615 | 399-611 | 438-594 |
| Height | 1397 | 1392 | 1387 | 1382 | 1377 |

The face moves the most in the first step, because the head leads the turn. On the left it then stays put, because the mirrored walk model's face is only 25 px from the standing art's. The front foot opens a little in T2/T3 and closes again in the walk model, like a small preparatory step.

In the running app (walk selftest), each turn frame is drawn at the pet's standing position. Window captures of the turn frames step 349 → 348 → 347 → 346 → 345 px tall. The last turn frame and the first frame of the walk are identical in both directions. The walk's frame lock is unchanged (drift 0, step error 0), and the left walk lands exactly on its 420 px target.

## Bows and tail

| Drawing | Bows | Tail |
|---|---|---|
| Standing art | screen-right ear | peeks out at the right |
| T1 | screen-right ear | small tip at the right |
| T2 | screen-right ear (now the far ear) | hidden behind the skirt |
| T3 | near ear, screen left | at the left behind the skirt |
| Walk model | near ear, screen left | at the left behind the skirt |
| T1L, T2L, T3L, mirrored walk | screen-right ear | at the right |

## Not fully satisfied

- **Right turn: the bows change ears once, between T2 and T3.** This is not a drawing error. The standing art has the bows on her left ear (screen right), but the approved walk model has them on the ear nearer the viewer (screen left). One switch is unavoidable unless the walk model is redrawn. It now happens once, at the step where the head turns past the middle, and the tail is hidden in T2, so the tail's switch from right to left is not a jump either. At pet size the bows are 3-4 px.
- The middle drawings came out with the head a little more turned than halfway (T2L most of all, eyes 459 as delivered). Registration moves T2L by 14 px, which brings it back between its neighbours, but its face is still 3 px past T3L's. That is under 1 px on screen.
- The head does most of its travel in the first drawing (27 of 49 px on the right). That is the intended "head leads" timing. A slower head would need T1 redrawn with less head turn.

Files: `contact-sheet.png` (rows: right turn as delivered, right turn as the app shows it, then the same two for the left turn), `preview.gif` (10 fps: right turn and back, then left turn and back, as the app shows them).
