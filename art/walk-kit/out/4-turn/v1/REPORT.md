# Stage 4 report: the start and stop turn (T1, T2)

Generated with Codex's built-in image tool (2 runs, 3 tries each), checked and integrated on 2026-11-11.

## Accepted drawings

| Drawing | Source | Why |
|---|---|---|
| `T1.png` | `attempts/T1-try-3.png` | Face rendering closest to the walk model; hands open and relaxed at the hem; both soles flat; tail tip at the right |
| `T2.png` | `attempts/T2-try-3.png` | Lowest score; face nearly identical in style to the walk model; feet together; bows and tail like the walk model |

## Measurements (`feet_check` logic, JS port, on the drawings as delivered)

| File | eyes_x | feet (bottom 40 rows) | score | Outside the Stage 4 target |
|---|---|---|---|---|
| T1-try-1.png | 541 | 414-607 | 21 | eyes_x 541 (want 508-526); feet_left 414 (want 420-455) |
| T1-try-2.png | 542 | 419-607 | 17 | eyes_x 542 (want 508-526); feet_left 419 (want 420-455) |
| **T1-try-3.png** | 541 | 408-603 | 27 | eyes_x 541 (want 508-526); feet_left 408 (want 420-455) |
| T2-try-1.png | 561 | 430-584 | 18 | eyes_x 561 (want 525-543) |
| T2-try-2.png | 558 | 435-590 | 15 | eyes_x 558 (want 525-543) |
| **T2-try-3.png** | 557 | 429-584 | 14 | eyes_x 557 (want 525-543) |
| walk-base.png (end) | 550 | 429-587 | | |
| standing art (start) | 500 | 437-654 | | |

No try reached the face targets: all three T1 tries turned the head about 60% of the way, so the head leads the turn more than the table planned. The hips are about one third of the way (hip centre 501 against 514 for the standing art and 473 for the walk model), and that is the part that reads as a turn at pet size. These were kept rather than spending more tries, because the build corrects position and size:

- **Height** is stepped from the standing art to the walk's passing frames (1397 → 1390 → 1385 → 1378 → 1372 px), so the head no longer dips when the first step starts.
- **x** is shifted by the least-squares compromise between the feet and the face (T1 +10 px, T2 +2 px). After this, both feet stay within about 20 px of where they stand (5 px on screen).
- **Colours** are matched to the standing art the same way as the walk frames.

After processing: T1 has feet at 418-613 and eyes at 551. T2 has feet at 432-585 and eyes at 559. The walk model has feet at 430-586 and eyes at 549.

## Bows and tail

| Drawing | Bows | Tail |
|---|---|---|
| Standing art | screen-right ear | peeks out at the right |
| T1 | screen-right ear | small tip at the right |
| T2 | near ear, screen left | at the left behind the skirt |
| Walk model | near ear, screen left | at the left behind the skirt |

## In the app

Start of a walk: standing art → T1 (0.10 s) → T2 (0.09 s) → walk model (0.07 s) → walk, which starts on a passing frame. A stop ends on a passing frame and plays the turn backwards. The pet's root is the standing art's foot point, so she turns in place.

Walking left uses the mirrored drawings. The bows therefore switch ears between the standing art and T1, and again between T1 and T2. This is the same mirroring limitation as the walk; at pet size the bows are 3-4 px.

## Not fully satisfied

- The face moves most of the way in the first drawing (500 → 551), and T2 slightly overshoots the walk model (559 against 549, which is 2-3 px on screen). A T1 drawn with the face only slightly turned would spread the head motion more evenly. If wanted, regenerate T1 with the head turned about 5-8 degrees and the face at x ≈ 520.
- The left turn shows the mirrored bows (see above).

Files: `contact-sheet.png` (top: as delivered with green turned to white; bottom: as the app shows them, plus the first walk frame), `preview.gif` (10 fps: stand, T1, T2, walk model, W12 hold, and back).
