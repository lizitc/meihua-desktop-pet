# Stage 3 脚位结果（手臂复查未通过）

> 后续逐帧复查确认手臂冻结、跳变及 Passing 锚点偏离参考：W05→W06、W10→W11 不连续，W04/W12 未收回体侧。此前整体视觉验收不足；下面的脚位通过结果仍有效，但不能代表完整动画已通过。详见 [手臂复查报告](../arm-review/REPORT.md) 及 [对照慢放](../arm-review/arms-comparison-4fps.gif)。当前状态：手臂待修正。

已生成 W01、W03、W05、W07、W09、W11、W13、W15 共 8 张中间帧，全部通过原版 tools/feet_check.py，均为 pass=true、score=0；同时人工检查了腿部身份、遮挡关系、两条腿、两只完整袜脚和两只手。
全程使用内置 image_gen.imagegen，共 19 次生成、11 次重试，按 W03、W11、W05、W13、W01、W09、W07、W15 顺序生成。每次均使用任务规定顺序的 5 张参考图并展开 CHARACTER、TECH 固定块。

## 保存文件

- out/3-inbetweens/W01.png、W03.png、W05.png、W07.png、W09.png、W11.png、W13.png、W15.png：8 张 1024×1536、不透明绿底原始生成图。
- out/3-inbetweens/contact-sheet.png：3072×1232，W00–W07 在第一行，W08–W15 在第二行，每行 8 张，绿底转白底。
- out/3-inbetweens/preview.gif：16 帧，512×768，名义 14 fps，无限循环，绿底转纯白。GIF 以 10ms 存储时间，采用 14 个 70ms 和 2 个 80ms 帧间隔，循环 1140ms，实际均值约 14.035 fps。
- out/3-inbetweens/attempts/Wxx-try-N.png 及同名 JSON：所有尝试、逐次测量、视觉判定、完整提示词和有序参考路径。
- generation.json / prompts.json：生成记录与提示词计划；feet-final.jsonl / feet-final.json：最终 16 帧的原版工具输出。
- preservation-checks.json / generation-source-checks.json / basic-checks-information-only.json / review-checks.json / summary.json：保留性、原图来源、尺寸与预览检查。
- make_review.py / finalize.py：可重跑的预览和只读核验脚本。

## 重试与选择

- W03：生成 5 次，重试 4 次；采用第 5 次；score：27 → 24 → 16 → 13 → 0。
- W11：生成 1 次，重试 0 次；采用第 1 次；score：0。
- W05：生成 4 次，重试 3 次；采用第 4 次；score：2 → 7 → 29 → 0。
- W13：生成 1 次，重试 0 次；采用第 1 次；score：0。
- W01：生成 1 次，重试 0 次；采用第 1 次；score：0。
- W09：生成 1 次，重试 0 次；采用第 1 次；score：0。
- W07：生成 3 次，重试 2 次；采用第 3 次；score：28 → 13 → 0。
- W15：生成 3 次，重试 2 次；采用第 3 次；score：53 → 14 → 0。

W07 第 1 次除了数值超界，手臂和腿部遮挡还偏向 W00，近远侧身份不可靠，因此拒绝。最终选择均同时满足测量和腿部身份检查，没有采用“6 次后最低分”的例外。

## 最终脚位

- W01：近侧前支撑脚跟 554；W03：近侧平脚支撑脚尖 579；W05：近侧支撑脚尖 478。
- W07：近侧后支撑脚尖 377，接触宽度 53；远侧前摆动脚尖 756，离地 44px。
- W09：远侧前支撑脚跟 583；W11：远侧平脚支撑脚尖 652；W13：远侧支撑脚尖 528。
- W15：远侧后支撑脚尖 425，接触宽度 54；近侧前摆动脚尖 719，离地 43px。

## 核验与保留

- 初始快照中的 71 个受保护文件 SHA-256 全部未变，包括 8 张已批准关键帧、其顶层审查文件和 refs / guides / processed / tools。未重画或覆盖任何关键帧，也未改动 feet_check.py 或测量范围。
- 所有最终中间帧与所选 imagegen 原图的 SHA-256 相同；所有尝试也保留了生成的原始像素。未用程序变形、移动、拼接或修补角色。程序只创建任务要求的总览/GIF，并在这两个审查文件中把绿底转白。
- 最终 16 张原图尺寸、不透明度、腰裙中心和相对 approved base 的轮廓高度 ±2.5% 检查通过。身体高度/底行和边框纯绿检查按 Stage 3 说明仅作信息记录，未据此重试。预览保持原画布坐标，没有逐帧对齐头部或脚底。
- 最终 16 帧中，8 张中间帧及 4 张 Stage 2c 有范围约束的关键帧，共 12 张通过工具目标。W00、W02、W08、W12 在该工具中没有目标范围，原样输出测量，不把它们虚报成 pass=true。

## 仍不完全满意的细节

- W01、W09 的后摆脚更接近后一个关键帧的弯曲/抬起状态，较理想的严格半程位置偏高、偏蜷；W05 的远侧摆动脚也偏蜷、偏高。它们的支撑脚均已通过数值目标，腿部身份正确，但不能据此宣称所有关节都精确居中。
- 手臂、裙褶、发梢和尾巴是逐张重画，仍有细小轮廓与阴影差异；工具的脚位通过并不等于这些部位已达到像素级连续。请结合 16 帧 GIF 评估运动观感。
- W07、W15 的前脚均未落地，最低点相对各自支撑脚地面为 44px、43px，已在 14–45px 要求内。原图的高度变化留给任务所述 build 调整。

## 原版 feet_check.py 最终 16 帧输出

命令：python -W ignore::DeprecationWarning tools/feet_check.py [依序传入下列 16 个原图路径]；退出码 0。只抑制 Pillow 弃用提示，测量逻辑未改动。

~~~jsonl
{"file": "out\\2-keys\\W00.png", "size": [1024, 1536], "ground": 1473, "floor_runs": [[298, 349], [606, 709]], "frame": "W00"}
{"file": "out\\3-inbetweens\\W01.png", "size": [1024, 1536], "ground": 1473, "floor_runs": [[554, 692]], "stance_toe": 692, "stance_heel": 554, "stance_width": 139, "frame": "W01", "pass": true, "score": 0, "fails": []}
{"file": "out\\2-keys\\W02.png", "size": [1024, 1536], "ground": 1480, "floor_runs": [[482, 610]], "stance_toe": 610, "stance_heel": 482, "stance_width": 129, "frame": "W02"}
{"file": "out\\3-inbetweens\\W03.png", "size": [1024, 1536], "ground": 1475, "floor_runs": [[435, 579]], "stance_toe": 579, "stance_heel": 435, "stance_width": 145, "frame": "W03", "pass": true, "score": 0, "fails": []}
{"file": "out\\2-keys\\W04.png", "size": [1024, 1536], "ground": 1478, "floor_runs": [[364, 515]], "stance_toe": 515, "stance_heel": 364, "stance_width": 152, "frame": "W04", "pass": true, "score": 0, "fails": []}
{"file": "out\\3-inbetweens\\W05.png", "size": [1024, 1536], "ground": 1479, "floor_runs": [[329, 478]], "stance_toe": 478, "stance_heel": 329, "stance_width": 150, "swing_toe": 574, "swing_lift": 117, "frame": "W05", "pass": true, "score": 0, "fails": []}
{"file": "out\\2-keys\\W06.png", "size": [1024, 1536], "ground": 1464, "floor_runs": [[370, 427]], "stance_toe": 427, "stance_heel": 370, "stance_width": 58, "swing_toe": 735, "swing_lift": 53, "frame": "W06", "pass": true, "score": 0, "fails": []}
{"file": "out\\3-inbetweens\\W07.png", "size": [1024, 1536], "ground": 1461, "floor_runs": [[325, 377]], "stance_toe": 377, "stance_heel": 325, "stance_width": 53, "swing_toe": 756, "swing_lift": 44, "frame": "W07", "pass": true, "score": 0, "fails": []}
{"file": "out\\2-keys\\W08.png", "size": [1024, 1536], "ground": 1466, "floor_runs": [[255, 310], [669, 717]], "frame": "W08"}
{"file": "out\\3-inbetweens\\W09.png", "size": [1024, 1536], "ground": 1469, "floor_runs": [[583, 723]], "stance_toe": 723, "stance_heel": 583, "stance_width": 141, "frame": "W09", "pass": true, "score": 0, "fails": []}
{"file": "out\\2-keys\\W10.png", "size": [1024, 1536], "ground": 1469, "floor_runs": [[533, 678]], "stance_toe": 678, "stance_heel": 533, "stance_width": 146, "frame": "W10", "pass": true, "score": 0, "fails": []}
{"file": "out\\3-inbetweens\\W11.png", "size": [1024, 1536], "ground": 1468, "floor_runs": [[504, 652]], "stance_toe": 652, "stance_heel": 504, "stance_width": 149, "frame": "W11", "pass": true, "score": 0, "fails": []}
{"file": "out\\2-keys\\W12.png", "size": [1024, 1536], "ground": 1478, "floor_runs": [[461, 585]], "stance_toe": 585, "stance_heel": 461, "stance_width": 125, "frame": "W12"}
{"file": "out\\3-inbetweens\\W13.png", "size": [1024, 1536], "ground": 1460, "floor_runs": [[402, 528]], "stance_toe": 528, "stance_heel": 402, "stance_width": 127, "swing_toe": 613, "swing_lift": 76, "frame": "W13", "pass": true, "score": 0, "fails": []}
{"file": "out\\2-keys\\W14.png", "size": [1024, 1536], "ground": 1474, "floor_runs": [[421, 474]], "stance_toe": 474, "stance_heel": 421, "stance_width": 54, "swing_toe": 664, "swing_lift": 55, "frame": "W14", "pass": true, "score": 0, "fails": []}
{"file": "out\\3-inbetweens\\W15.png", "size": [1024, 1536], "ground": 1461, "floor_runs": [[372, 425]], "stance_toe": 425, "stance_heel": 372, "stance_width": 54, "swing_toe": 719, "swing_lift": 43, "frame": "W15", "pass": true, "score": 0, "fails": []}
~~~

本阶段到此结束，未执行可选 Stage 4。
