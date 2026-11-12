# Stage 3b：W05 / W13 摆动脚时序修正

2026-11-10。只执行 Stage 3b，已替换两张正式中间帧；其余 14 张正式帧 SHA-256 与开始前一致。

## 结果

| 帧 | swing_tip 修正前 → 后 | 支撑脚趾 x | 原工具判定 | 尝试 / 重试 |
|---|---|---|---|---|
| W05 | 574 → 645 | 477（目标451–491） | pass=true，score=0；摆动脚离地85px | 6 / 5 |
| W13 | 613 → 557 | 528（目标510–550） | pass=true，score=0；脚部审查ROI离地64px | 6 / 5 |

- W05：远侧腿在后方遮挡关系中前摆，完整脚掌离地；近侧腿支撑。
- W13：近侧腿前景通过，摆动脚收回至支撑脚旁；远侧腿支撑。
- 两帧均视觉检查：两条完整腿、两个完整袜脚、近远腿身份正确，无多肢或融合；双臂、手的摆动姿势保留。
- 未改变其余正式帧；未修改 refs、guides、tools，也未更新旧 out/arm-fix/frames/ 副本。后续应使用正式 out/2-keys/ 与 out/3-inbetweens/。
- 本次全部采用内置 image_gen.imagegen；正式 PNG 与所选生成原图逐字节一致，没有程序变形、拼接、补绘或插帧。

## 保留区域检查与限制

- W05 支撑脚接触区间由 [329,478] 到 [329,477]，地面行1477未变；W13 接触区间[403,528]未变，地面行由1458到1456。
- 双臂和手的前后对照见 [arms-comparison.png](arms-comparison.png)，手部颜色连通域边界最大差3px；姿势视觉检查保留。颜色阈值可能拆分手指连通域，质心只作诊断。
- 两张局部生成编辑在非腿区域仍有微小线条、边缘、色阶差异，不宣称逐像素不变；具体区域轮廓IoU和色差记录见 [preservation.json](preservation.json)。
- 画布1024×1536、不透明、头顶范围、腰裙中心和相对模型轮廓高度检查通过。身体bob与边框绿仅记录，不作为本阶段重试目标。没有未通过脚位目标的采用帧。

## 文件

- 正式输出：[W05.png](../W05.png)、[W13.png](../W13.png)。
- 原图备份：[W05-before-3b.png](../attempts/W05-before-3b.png)、[W13-before-3b.png](../attempts/W13-before-3b.png)。
- 每次尝试：../attempts/W05-3b-try-1.png … W05-3b-try-6.png；W13-3b-try-1.png … W13-3b-try-6.png。
- [16帧两行总览](../contact-sheet.png)：W00–W07在第一行，W08–W15在第二行。
- [16帧白底循环GIF](../preview.gif)：名义14fps；GIF时间以70/80ms量化，总长1140ms，loop=0。
- 全部提示词、有序参考图版本、生成原图路径、SHA-256与视觉记录：[generation.json](generation.json)。
- 初测及全部尝试测量：[before-feet.jsonl](before-feet.jsonl)、[attempt-feet.jsonl](attempt-feet.jsonl)。

## 每次尝试

| 帧 / 次数 | stance_toe | swing_tip | swing_lift | score | 结果 |
|---|---:|---:|---:|---:|---|
| W05 / 1 | 478 | 642 | 111 | 11 | 拒绝：脚位目标未通过 |
| W05 / 2 | 478 | 636 | 107 | 7 | 拒绝：脚位目标未通过 |
| W05 / 3 | 478 | 714 | 135 | 97 | 拒绝：脚位目标未通过 |
| W05 / 4 | 478 | 594 | 110 | 28 | 拒绝：脚位目标未通过 |
| W05 / 5 | 478 | 665 | 90 | 13 | 拒绝：脚位目标未通过 |
| W05 / 6 | 477 | 645 | 85 | 0 | 采用 |
| W13 / 1 | 527 | 586 | 72 | 18 | 拒绝：脚位目标未通过 |
| W13 / 2 | 558 | 558 | — | 8 | 拒绝：支撑脚移动 |
| W13 / 3 | 527 | 583 | 75 | 15 | 拒绝：脚位目标未通过 |
| W13 / 4 | 528 | 568 | 88 | 0 | 未采用：腰裙中心偏左0.33px |
| W13 / 5 | 527 | 569 | 89 | 1 | 拒绝：脚位目标未通过 |
| W13 / 6 | 528 | 557 | — | 0 | 采用 |

## 最终16帧 feet_check.py 原始输出

原脚本未修改。12个有目标的帧全部pass=true、score=0；W00/W02/W08/W12无目标，只输出测量。W13的swing_lift没有目标，原工具只扫描支撑脚趾右侧40px以外，不能代表窄姿态下整个摆动脚的最低点；本帧离地高度另作视觉检查。

```jsonl
{"file": "out\\2-keys\\W00.png", "size": [1024, 1536], "ground": 1472, "floor_runs": [[298, 349], [606, 708]], "swing_tip": 738, "frame": "W00"}
{"file": "out\\3-inbetweens\\W01.png", "size": [1024, 1536], "ground": 1472, "floor_runs": [[555, 694]], "swing_tip": 639, "stance_toe": 694, "stance_heel": 555, "stance_width": 140, "frame": "W01", "pass": true, "score": 0, "fails": []}
{"file": "out\\2-keys\\W02.png", "size": [1024, 1536], "ground": 1478, "floor_runs": [[480, 608]], "swing_tip": 562, "stance_toe": 608, "stance_heel": 480, "stance_width": 129, "frame": "W02"}
{"file": "out\\3-inbetweens\\W03.png", "size": [1024, 1536], "ground": 1473, "floor_runs": [[436, 578]], "swing_tip": 524, "stance_toe": 578, "stance_heel": 436, "stance_width": 143, "frame": "W03", "pass": true, "score": 0, "fails": []}
{"file": "out\\2-keys\\W04.png", "size": [1024, 1536], "ground": 1477, "floor_runs": [[364, 515]], "swing_tip": 531, "stance_toe": 515, "stance_heel": 364, "stance_width": 152, "frame": "W04", "pass": true, "score": 0, "fails": []}
{"file": "out\\3-inbetweens\\W05.png", "size": [1024, 1536], "ground": 1477, "floor_runs": [[329, 477]], "swing_tip": 645, "stance_toe": 477, "stance_heel": 329, "stance_width": 149, "swing_toe": 645, "swing_lift": 85, "frame": "W05", "pass": true, "score": 0, "fails": []}
{"file": "out\\2-keys\\W06.png", "size": [1024, 1536], "ground": 1463, "floor_runs": [[369, 426]], "swing_tip": 734, "stance_toe": 426, "stance_heel": 369, "stance_width": 58, "swing_toe": 734, "swing_lift": 53, "frame": "W06", "pass": true, "score": 0, "fails": []}
{"file": "out\\3-inbetweens\\W07.png", "size": [1024, 1536], "ground": 1459, "floor_runs": [[325, 377]], "swing_tip": 756, "stance_toe": 377, "stance_heel": 325, "stance_width": 53, "swing_toe": 756, "swing_lift": 43, "frame": "W07", "pass": true, "score": 0, "fails": []}
{"file": "out\\2-keys\\W08.png", "size": [1024, 1536], "ground": 1463, "floor_runs": [[255, 311], [670, 717]], "swing_tip": 784, "frame": "W08"}
{"file": "out\\3-inbetweens\\W09.png", "size": [1024, 1536], "ground": 1467, "floor_runs": [[582, 725]], "swing_tip": 664, "stance_toe": 725, "stance_heel": 582, "stance_width": 144, "frame": "W09", "pass": true, "score": 0, "fails": []}
{"file": "out\\2-keys\\W10.png", "size": [1024, 1536], "ground": 1468, "floor_runs": [[532, 677]], "swing_tip": 620, "stance_toe": 677, "stance_heel": 532, "stance_width": 146, "frame": "W10", "pass": true, "score": 0, "fails": []}
{"file": "out\\3-inbetweens\\W11.png", "size": [1024, 1536], "ground": 1468, "floor_runs": [[504, 650]], "swing_tip": 590, "stance_toe": 650, "stance_heel": 504, "stance_width": 147, "frame": "W11", "pass": true, "score": 0, "fails": []}
{"file": "out\\2-keys\\W12.png", "size": [1024, 1536], "ground": 1477, "floor_runs": [[460, 585]], "swing_tip": 536, "stance_toe": 585, "stance_heel": 460, "stance_width": 126, "frame": "W12"}
{"file": "out\\3-inbetweens\\W13.png", "size": [1024, 1536], "ground": 1456, "floor_runs": [[403, 528]], "swing_tip": 557, "stance_toe": 528, "stance_heel": 403, "stance_width": 126, "frame": "W13", "pass": true, "score": 0, "fails": []}
{"file": "out\\2-keys\\W14.png", "size": [1024, 1536], "ground": 1471, "floor_runs": [[422, 474]], "swing_tip": 662, "stance_toe": 474, "stance_heel": 422, "stance_width": 53, "swing_toe": 662, "swing_lift": 53, "frame": "W14", "pass": true, "score": 0, "fails": []}
{"file": "out\\3-inbetweens\\W15.png", "size": [1024, 1536], "ground": 1461, "floor_runs": [[372, 425]], "swing_tip": 718, "stance_toe": 425, "stance_heel": 372, "stance_width": 54, "swing_toe": 718, "swing_lift": 43, "frame": "W15", "pass": true, "score": 0, "fails": []}
```
