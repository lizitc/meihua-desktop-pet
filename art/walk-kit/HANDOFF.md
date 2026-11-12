# 摆臂修复交接

2026-11-10：完整 16 帧双臂修复已完成，已替换正式素材。用户明确要求完全修复并允许在交接文档说明关键帧变动，本次授权覆盖原 Stage3 的“不重画关键帧”限制。

## 当前使用的素材

- 完整有序 16 帧：out/arm-fix/frames/W00.png … W15.png，均为 1024×1536、不透明绿底 PNG。
- 正式偶数关键帧：out/2-keys/W00.png、W02.png、W04.png、W06.png、W08.png、W10.png、W12.png、W14.png，8 张均已更新。
- 正式奇数中间帧：out/3-inbetweens/W01.png … W15.png，8 张均已更新；与完整帧目录逐字节一致。
- [完整 16 帧预览](out/arm-fix/preview.gif)：名义 14 fps、白底、无限循环；GIF 以70/80ms量化，16帧1140ms，实际均值14.035fps。
- [双臂慢放](out/arm-fix/arms-preview-4fps.gif)、[修复前后对照](out/arm-fix/before-after-4fps.gif)、[双臂总览](out/arm-fix/arms-contact-sheet.png)。
- [全身两行总览](out/arm-fix/contact-sheet.png)，W00–W07 第一行，W08–W15 第二行。
- out/2-keys/contact-sheet.png、preview.gif 已同步重建（8帧8fps）；out/3-inbetweens/contact-sheet.png、preview.gif 已同步完整16帧。

## 关键帧具体变动

- **W00**：收窄近侧后摆与远侧前摆，建立轻柔后摆极值。采用本次第 4 次，脚底接触区间 [[298, 349], [606, 708]]。
- **W02**：双臂由后摆逐步回到体侧，不再冻结旧接触姿势。采用本次第 3 次，脚底接触区间 [[480, 608]]。
- **W04**：双臂垂落贴近身体，重建 Passing 中立锚点。采用本次第 2 次，脚底接触区间 [[364, 515]]。
- **W06**：近侧小幅前摆；远侧向后、部分进入躯干遮挡，去掉原先横跨围裙的手臂。采用本次第 2 次，脚底接触区间 [[369, 426]]。
- **W08**：建立近侧前摆极值；远侧臂后摆到躯干/围裙右缘之后，仅露出自然的手指边缘。采用本次第 4 次，脚底接触区间 [[255, 311], [670, 717]]。
- **W10**：双臂从前摆平缓回到中立；远侧手逐步从遮挡中露出。采用本次第 2 次，脚底接触区间 [[532, 677]]。
- **W12**：双臂贴近体侧，与 W04 的中立锚点一致。采用本次第 2 次，脚底接触区间 [[460, 585]]。
- **W14**：近侧轻微后摆、远侧轻微前摆，为 W15→W00 回环衔接。采用本次第 4 次，脚底接触区间 [[422, 474]]。

关键帧更改针对手臂、袖口、手及其遮挡处必要的局部裙/发区域。角色身份、朝向、服装设计、腿部身份和既有脚位要求保持。图像生成编辑会带来微小线条/边缘差异，不宣称其他区域逐像素完全一致。
复测脚底接触端点相对修复前最大差 2px，地面行最大差 3px；未修改测量脚本或目标范围。

## 已修复的问题

- 用后摆→体侧中立→前摆→体侧中立→后摆的完整小幅周期替代原来的两套静态手臂切换。
- W04/W12 已重建为真正的 Passing 垂臂锚点；中间帧重新跟随这些锚点。
- W05 由中立逐步前摆，W11 从前摆回收，消除原 W05→W06 和 W10→W11 的突然反向/切换。
- 近侧手沿身体旁的小弧线运动，手指放松向下；远侧臂反向摆动，并逐渐进入/退出躯干、围裙边缘的自然遮挡。
- W08 等处远侧手只露出一部分指缘是正确遮挡，手臂和手在躯干之后完整连接，不是缺手或截断。

## 验证结果

- 40 次内置 image_gen.imagegen 调用，24 次重试；每帧不超过6次。全部尝试保存在 out/arm-fix/attempts/，完整提示词、有序参考图版本与 SHA-256 见 generation.json。
- 最终 PNG 与所选 imagegen 原图 SHA-256 相同；没有程序变形、补绘、混合角色帧或 AI 光流插帧。程序仅生成审查总览/GIF、读取测量和复制所选原图。
- 最终16帧的12个有目标帧（8个奇数帧+W04/W06/W10/W14）全部 feet_check.py pass=true、score=0；W00/W02/W08/W12 无脚位目标，只输出实测。
- 近侧手肤色连通域质心的最大相邻位移 46.37px；W15→W00 闭环差 1.84px。8张奇数帧质心距相邻关键帧质心中点均小于20px。数值是只读诊断代理，不等同于精确骨架关节跟踪；完整运动、手形和远侧遮挡另作逐帧视觉检查。
- 最终16帧画布、不透明度、头顶范围、腰裙中心与相对 approved base 的轮廓高度±2.5%通过；身体bob/边框纯绿按任务说明仅作信息记录。
- W07/W15 前脚仍完整离地，具体数值见下方原版工具输出。

## 备份与后续操作

- 修复前全部16张 PNG：out/arm-fix/before/frames/；修复前报告、脚位数据和预览也在 out/arm-fix/before/ 中。
- refs / guides / tools / processed 中快照覆盖的 38 个文件 SHA-256 未变；旧报告和失败尝试保留为历史。
- 当前交付状态以本文件和 out/arm-fix/summary.json 为准。out/arm-review/ 是修复前的问题记录，已经补充解决状态；早期 Stage2/3 生成记录属于历史。
- 无需重新挑选8张关键帧。后续合成直接使用 out/arm-fix/frames/ 的W00–W15，或正式 out/2-keys 与 out/3-inbetweens 同编号文件。
- 重建审查图：python out/arm-fix/make_review.py；只读核验当前交付：python -W ignore::DeprecationWarning out/arm-fix/finalize.py --verify-only。
- 旧 Stage3 finalize.py 已转发到当前只读核验，避免旧生成记录覆盖最新交付状态。
- 当前交付是走路素材包，桌宠程序的抠除绿底、位置对齐与打包沿用原交接流程。

## 本次每帧尝试数

- W00：生成 4 次，重试 3 次，最终采用第 4 次。
- W01：生成 1 次，重试 0 次，最终采用第 1 次。
- W02：生成 3 次，重试 2 次，最终采用第 3 次。
- W03：生成 2 次，重试 1 次，最终采用第 2 次。
- W04：生成 2 次，重试 1 次，最终采用第 2 次。
- W05：生成 3 次，重试 2 次，最终采用第 3 次。
- W06：生成 2 次，重试 1 次，最终采用第 2 次。
- W07：生成 1 次，重试 0 次，最终采用第 1 次。
- W08：生成 4 次，重试 3 次，最终采用第 4 次。
- W09：生成 2 次，重试 1 次，最终采用第 2 次。
- W10：生成 2 次，重试 1 次，最终采用第 2 次。
- W11：生成 4 次，重试 3 次，最终采用第 4 次。
- W12：生成 2 次，重试 1 次，最终采用第 2 次。
- W13：生成 3 次，重试 2 次，最终采用第 3 次。
- W14：生成 4 次，重试 3 次，最终采用第 4 次。
- W15：生成 1 次，重试 0 次，最终采用第 1 次。

## 原版 feet_check.py 最终16帧输出

~~~jsonl
{"file": "out\\arm-fix\\frames\\W00.png", "size": [1024, 1536], "ground": 1472, "floor_runs": [[298, 349], [606, 708]], "frame": "W00"}
{"file": "out\\arm-fix\\frames\\W01.png", "size": [1024, 1536], "ground": 1472, "floor_runs": [[555, 694]], "stance_toe": 694, "stance_heel": 555, "stance_width": 140, "frame": "W01", "pass": true, "score": 0, "fails": []}
{"file": "out\\arm-fix\\frames\\W02.png", "size": [1024, 1536], "ground": 1478, "floor_runs": [[480, 608]], "stance_toe": 608, "stance_heel": 480, "stance_width": 129, "frame": "W02"}
{"file": "out\\arm-fix\\frames\\W03.png", "size": [1024, 1536], "ground": 1473, "floor_runs": [[436, 578]], "stance_toe": 578, "stance_heel": 436, "stance_width": 143, "frame": "W03", "pass": true, "score": 0, "fails": []}
{"file": "out\\arm-fix\\frames\\W04.png", "size": [1024, 1536], "ground": 1477, "floor_runs": [[364, 515]], "stance_toe": 515, "stance_heel": 364, "stance_width": 152, "frame": "W04", "pass": true, "score": 0, "fails": []}
{"file": "out\\arm-fix\\frames\\W05.png", "size": [1024, 1536], "ground": 1477, "floor_runs": [[329, 478]], "stance_toe": 478, "stance_heel": 329, "stance_width": 150, "swing_toe": 574, "swing_lift": 116, "frame": "W05", "pass": true, "score": 0, "fails": []}
{"file": "out\\arm-fix\\frames\\W06.png", "size": [1024, 1536], "ground": 1463, "floor_runs": [[369, 426]], "stance_toe": 426, "stance_heel": 369, "stance_width": 58, "swing_toe": 734, "swing_lift": 53, "frame": "W06", "pass": true, "score": 0, "fails": []}
{"file": "out\\arm-fix\\frames\\W07.png", "size": [1024, 1536], "ground": 1459, "floor_runs": [[325, 377]], "stance_toe": 377, "stance_heel": 325, "stance_width": 53, "swing_toe": 756, "swing_lift": 43, "frame": "W07", "pass": true, "score": 0, "fails": []}
{"file": "out\\arm-fix\\frames\\W08.png", "size": [1024, 1536], "ground": 1463, "floor_runs": [[255, 311], [670, 717]], "frame": "W08"}
{"file": "out\\arm-fix\\frames\\W09.png", "size": [1024, 1536], "ground": 1467, "floor_runs": [[582, 725]], "stance_toe": 725, "stance_heel": 582, "stance_width": 144, "frame": "W09", "pass": true, "score": 0, "fails": []}
{"file": "out\\arm-fix\\frames\\W10.png", "size": [1024, 1536], "ground": 1468, "floor_runs": [[532, 677]], "stance_toe": 677, "stance_heel": 532, "stance_width": 146, "frame": "W10", "pass": true, "score": 0, "fails": []}
{"file": "out\\arm-fix\\frames\\W11.png", "size": [1024, 1536], "ground": 1468, "floor_runs": [[504, 650]], "stance_toe": 650, "stance_heel": 504, "stance_width": 147, "frame": "W11", "pass": true, "score": 0, "fails": []}
{"file": "out\\arm-fix\\frames\\W12.png", "size": [1024, 1536], "ground": 1477, "floor_runs": [[460, 585]], "stance_toe": 585, "stance_heel": 460, "stance_width": 126, "frame": "W12"}
{"file": "out\\arm-fix\\frames\\W13.png", "size": [1024, 1536], "ground": 1458, "floor_runs": [[403, 528]], "stance_toe": 528, "stance_heel": 403, "stance_width": 126, "swing_toe": 613, "swing_lift": 75, "frame": "W13", "pass": true, "score": 0, "fails": []}
{"file": "out\\arm-fix\\frames\\W14.png", "size": [1024, 1536], "ground": 1471, "floor_runs": [[422, 474]], "stance_toe": 474, "stance_heel": 422, "stance_width": 53, "swing_toe": 662, "swing_lift": 53, "frame": "W14", "pass": true, "score": 0, "fails": []}
{"file": "out\\arm-fix\\frames\\W15.png", "size": [1024, 1536], "ground": 1461, "floor_runs": [[372, 425]], "stance_toe": 425, "stance_heel": 372, "stance_width": 54, "swing_toe": 718, "swing_lift": 43, "frame": "W15", "pass": true, "score": 0, "fails": []}
~~~
