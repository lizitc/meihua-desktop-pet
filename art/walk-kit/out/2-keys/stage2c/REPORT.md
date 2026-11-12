# Stage 2c 完成记录

已按 CODEX-TASK.md 的 Stage 2c，仅重绘 W04、W10、W06、W14，并按该顺序生成。四张最终修正帧均通过原始 tools/feet_check.py：**pass=true、score=0**。总览图和白底循环 GIF 已重制，最终八帧的完整测量输出附在下方。

W00、W02、W08、W12 未重绘，文件 SHA256 与执行前完全一致。refs/、processed/ 和 tools/feet_check.py 也保持原样。特别遵循新文档的纠正：W08 比 W00 更宽的步幅属于三分之四视角的正常投影，当前 W08 已接受，本轮没有再修改它。

## 基线确认

开始重绘前实际运行 feet_check.py，四个原始支撑脚尖位置与文档完全一致：W04=584、W06=315、W10=591、W14=347。原始八帧输出保存为 feet-before.jsonl。

## 最终修正结果

- **W04**：近侧腿直立承重、脚掌平放，脚尖 x=515（要求500–540）；着地宽152px（要求至少95px），只有一只脚着地。采用第2次结果。
- **W10**：远侧腿在胯前承重、脚掌平放，脚尖 x=678（要求657–697）；着地宽146px（要求至少95px），近侧腿在前景弯曲向后抬起。采用第3次结果。
- **W06**：近侧后脚仅以前掌/脚尖支撑，脚尖 x=427（要求395–435），着地宽58px（要求不超过85px）；远侧前脚悬空，脚尖 x=735（要求670–740），离地53px（要求20–55px）。采用第6次结果，摆臂方向与后腿配合。
- **W14**：远侧后脚仅以前掌/脚尖支撑，脚尖 x=474（要求437–477），着地宽54px（要求不超过85px）；近侧前脚在前景悬空，脚尖 x=664（要求630–700），离地55px（要求20–55px）。采用第1次结果。

以上四张均经目视确认近远腿身份、前后遮挡与支撑脚正确，保留两条完整腿、两只袜足、两只连接到衣袖的放松手；没有融合或多余肢体。角色面部、犬耳、耳饰、服装及朝右三分之四视角沿用已批准模型，没有镜像。

## 仍可复核的细节

W04 和 W10 的后方摆动脚抬起幅度比引导图更大，尤其 W10 仍偏高；feet_check.py 对这两帧只约束支撑脚的位置、平放和唯一落地，不对其摆动脚高度设数值门槛。这不影响本轮四张脚位检查通过，但建议在连播时观察动作感觉。W06、W14 的前脚离地高度已由工具明确测得并在本阶段范围内。

按照 Stage 2c 的说明，身体起伏不作为本轮目标，边框绿底纯度只作信息记录；没有为这两项额外重画。旧基础检查的原始数据保存在 basic-checks-information-only.json 和父目录 checks.json，当前脚位验收以未改动的 tools/feet_check.py 为准。

## 文件与备份

已替换父目录四张独立的 1024×1536 不透明绿底 PNG：../W04.png、../W10.png、../W06.png、../W14.png。

替换前文件分别保存为 ../attempts/W04-v2.png、W10-v2.png、W06-v2.png、W14-v2.png，SHA256 已确认与此前生成源文件一致。本轮所有尝试保存在 ../attempts/Wxx-2c-try-N.png；修正前的复核图、GIF、报告及元数据保存在 before/。

- ../contact-sheet.png：3072×616，白底单行，顺序为 W00、W02、W04、W06、W08、W10、W12、W14，保留原始画布相对位置。
- ../preview.gif：512×768，白底，平均8fps、循环1000ms；GIF时间精度为10ms，故交替使用120/130ms帧时长。
- feet-final.jsonl：最终八帧 feet_check.py 的原始标准输出。
- feet-final.json、各 Wxx-final-feet-check.json：同一测量结果的结构化副本。
- generation.json：全部12次生成的完整提示词、五张参考图的顺序、数值检查、目视判断和最终选择。
- prompts.json：从文档展开的基础提示词与本轮脚位约束。
- preservation-checks.json：四张已批准帧、参考资料、测量脚本、生成源和 v2 备份的 SHA256 核验，全部通过。
- finalize.py：运行原始脚位检查并核验文件保留状态的复核脚本。

图像生成使用内置 image_gen.imagegen，未使用 CLI/API 回退。每次生成都按本阶段表格顺序传入五张参考图；W06 采用新 W04，W14 采用新 W06。所有最终 PNG 与所选生成器输出逐字节一致，未用程序移动、缩放或拼接角色、修改肢体或改变绿底；Pillow 只用于读取信息以及按要求制作白底总览/GIF。

## 重试记录

本轮共生成12次，重试8次，没有超过每帧最多6次的限制。

- W04：2次，重试1次；首次脚尖480偏后，第2次515通过。
- W10：3次，重试2次；首次近远腿身份错误而拒绝，第2次身份正确但脚尖707偏前，第3次678通过。
- W06：6次，重试5次；第2次脚位通过但摆臂方向不理想，保留作备选；后续修正中出现了脚位回漂和前脚缩回身下的版本；第6次脚位与摆臂同时合适，最终采用。
- W14：首轮通过，无重试。

没有因绿底或身体起伏使用重试额度。仅完成 Stage 2c，未进入 Stage 3。

## 最终八帧 feet_check.py 原始输出

运行命令：`python tools/feet_check.py out/2-keys/W00.png out/2-keys/W02.png out/2-keys/W04.png out/2-keys/W06.png out/2-keys/W08.png out/2-keys/W10.png out/2-keys/W12.png out/2-keys/W14.png`。原脚本仅为四张修正帧定义验收范围，因此其他已接受帧没有 pass/score 字段；没有为它们补造判定。进程退出码为0。

```jsonl
{"file": "out\\2-keys\\W00.png", "size": [1024, 1536], "ground": 1473, "floor_runs": [[298, 349], [606, 709]], "frame": "W00"}
{"file": "out\\2-keys\\W02.png", "size": [1024, 1536], "ground": 1480, "floor_runs": [[482, 610]], "stance_toe": 610, "stance_width": 129, "frame": "W02"}
{"file": "out\\2-keys\\W04.png", "size": [1024, 1536], "ground": 1478, "floor_runs": [[364, 515]], "stance_toe": 515, "stance_width": 152, "frame": "W04", "pass": true, "score": 0, "fails": []}
{"file": "out\\2-keys\\W06.png", "size": [1024, 1536], "ground": 1464, "floor_runs": [[370, 427]], "stance_toe": 427, "stance_width": 58, "swing_toe": 735, "swing_lift": 53, "frame": "W06", "pass": true, "score": 0, "fails": []}
{"file": "out\\2-keys\\W08.png", "size": [1024, 1536], "ground": 1466, "floor_runs": [[255, 310], [669, 717]], "frame": "W08"}
{"file": "out\\2-keys\\W10.png", "size": [1024, 1536], "ground": 1469, "floor_runs": [[533, 678]], "stance_toe": 678, "stance_width": 146, "frame": "W10", "pass": true, "score": 0, "fails": []}
{"file": "out\\2-keys\\W12.png", "size": [1024, 1536], "ground": 1478, "floor_runs": [[461, 585]], "stance_toe": 585, "stance_width": 125, "frame": "W12"}
{"file": "out\\2-keys\\W14.png", "size": [1024, 1536], "ground": 1474, "floor_runs": [[421, 474]], "stance_toe": 474, "stance_width": 54, "swing_toe": 664, "swing_lift": 55, "frame": "W14", "pass": true, "score": 0, "fails": []}
```

## 复核

在工作区运行 `python out/2-keys/stage2c/finalize.py` 可重新执行原始工具并验证保护文件、备份和源图；运行 `python out/2-keys/make_review.py` 可重制总览和 GIF。
