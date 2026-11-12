# 御园莓华 · GPT-image 提示词包

程序本身**不需要**新图也能完整运行。下面这些图都是锦上添花：A、B 两组生成后放进指定文件夹，程序会**自动识别**，不用改代码；C 组需要我再接一下动画，属于下一阶段。

## 通用说明（每张图都适用）

- **参考图**：每次生成都附上这两张。
  - `Meihua-Asset-Handoff-20261109/05_Approved_Standing/renders/ich01A_101.png`：全身定稿。
  - `Meihua-Asset-Handoff-20261109/06_UI/assets/meihua-portrait.png`：头像。
- **背景**：要真正的透明通道（alpha），不要白底、格子底，也不要阴影地面。
- **画面**：不要文字、logo、签名、水印。
- **风格**：与定稿一致，即柔和的粉彩日系插画、细线稿、浅淡的柔和阴影、明亮的脸部。脸上不要加重阴影。
- **角色设定**：每条提示词里都已经带上，不要删减。

> 角色设定（英文版已写进每条提示词）：犬类兽人少女；白色垂耳犬耳，左耳（画面右侧）上有一个藏青色和一个桃粉色的小蝴蝶结；粉色荷叶边女仆头饰；白色长卷发，两侧低马尾用白色小花扎起；紫色眼睛；白色犬尾；白衬衫配泡泡袖和粉色缎带，领口有红色领结；粉色高腰背带裙，下摆是白色荷叶边；奶油粉色围裙；白色过膝长袜配紫色蝴蝶结；**不穿鞋**，袜尖平滑圆润，不画脚趾。

```text
CHARACTER (keep exactly): Misono Meihua, a petite dog-girl (kemonomimi). Soft floppy WHITE DOG EARS hanging beside the face (they are dog ears, not rabbit ears) with a tiny navy-blue bow and a tiny peach bow on her left ear; pink frilled maid headband; very long wavy WHITE hair with two low side bunches tied with small white flowers; large violet/purple eyes; fluffy white dog tail; white blouse with puffed sleeves, pink ribbons on the sleeves, red bow tie at the collar; pink high-waisted suspender skirt with white frilled hem; pale cream-pink frilled apron; white thigh-high stockings with small purple bows; NO SHOES, stocking feet smooth and rounded with no toe lines. Bright clean face, gentle blush, no heavy face shading.
STYLE: soft pastel Japanese visual-novel illustration, thin clean lineart, very light soft cel shading, same palette as the reference images.
```

---

## A. 应用图标（建议优先做）

现在的图标是从立绘上裁出来再放大的，在任务栏和安装包里会发糊。

| 文件名 | 尺寸 | 放到 |
|---|---|---|
| `icon-1024.png` | 1024 × 1024，透明背景 | `meihua-desktop/assets/app/` |

交付后告诉我，我会从这张图生成 `icon.png`、`icon-512.png`、Windows `.ico` 和托盘小图标，然后重新打包。

```text
Use case: app icon. Create a 1024x1024 PNG with a genuinely transparent background.
A circular badge filling about 92% of the canvas: a thick berry-pink rim (#E4577B) around a soft cream (#FFF6EF) disc. Inside the disc, a cute chibi-proportioned head-and-shoulders portrait of the character below, facing the viewer, smiling with eyes gently closed in happiness (^ ^), light blush. Both floppy white dog ears clearly visible and slightly overlapping the rim on one side for charm; the pink maid headband and the small bows must be readable. Keep the shapes big and simple so the icon still reads at 32x32 and 16x16: bold clean outlines, few tiny details, high contrast between white hair and the cream disc (use a faint pink inner shadow along the hair edge, not a dark outline).
No text, no letters, no background outside the badge, no drop shadow outside the circle.
[paste the CHARACTER + STYLE block here]
```

---

## B. 手账贴纸（空白页插画，放进去自动生效）

每当列表为空时，手账会显示一张小贴纸，替代原本的圆形图标。显示尺寸约 132 × 132，所以构图要简单、剪影要清楚。

**统一规格**：

- 512 × 512 PNG，透明背景。
- 角色占画面约 80%，居中。
- Q 版比例，约 2.5 头身。
- 外围加一圈约 10px 的白色描边（模切贴纸效果）。
- 白色描边外再加一层极淡的粉色外缘（#F6D5DE，约 2px），好让白边在浅色底上也看得见。

**放到**：`meihua-desktop/assets/app/stickers/`（文件夹需要新建），文件名必须和下表一致。

| 文件名 | 用在哪 | 画面 |
|---|---|---|
| `day-free.png` | 今天、日程：没有安排 | 抱着软枕头、悠闲地伸懒腰，旁边一杯冒热气的奶茶 |
| `todo-done.png` | 待办清空 | 开心地举起一只手比耶，另一只手抱着一张打满勾的清单 |
| `reminder.png` | 提醒、例行任务为空 | 双手捧着一个小小的粉色闹钟，歪头微笑 |
| `memory.png` | 记忆为空 | 坐着翻一本带蝴蝶结书签的小日记本，尾巴轻轻摇 |
| `search.png` | 记忆搜索无结果 | 拿着放大镜困惑地歪头，头顶一个小问号气泡（气泡里不写字） |
| `skills.png` | 技能、扩展为空 | 捧着一本闪着小星星的魔法笔记本，表情期待 |
| `workshop.png` | 工坊没有任务 | 戴着小小的工匠围巾，抱着一个工具箱，干劲满满地握拳 |

**提示词模板**（把 `<SCENE>` 换成下面对应的一句）：

```text
Use case: UI sticker illustration. 512x512 PNG with a genuinely transparent background.
A die-cut sticker: a cute SD/chibi version (about 2.5 heads tall) of the character below, centered, filling about 80% of the canvas. <SCENE>
Outline the whole figure (including props) with a clean solid WHITE sticker border about 10 px wide, plus a very thin pale pink (#F6D5DE) outer edge so the white border stays visible on light backgrounds.
Simple readable silhouette, bold clean lines, soft pastel colors, little interior detail — it will be displayed at about 130 px. No text, no letters, no ground, no cast shadow, nothing outside the sticker border.
[paste the CHARACTER + STYLE block here]
```

`<SCENE>` 逐条：

```text
day-free:  She is relaxing happily, stretching with one arm up while hugging a soft round pillow, a small cup of milk tea with a wisp of steam floating beside her; eyes half-closed and content, tail curled.
todo-done: She cheerfully raises one hand in a V-sign while hugging a short paper checklist where every line has a pink check mark (no readable words, just lines and checks); bright open smile, tail wagging (motion lines).
reminder:  She holds a tiny round pink alarm clock up with both hands toward the viewer, head tilted with a gentle smile, ears perked slightly forward.
memory:    She sits with knees together reading a small pink diary with a ribbon bookmark, looking up at the viewer with a soft warm smile, tail swaying.
search:    She peers through a big round magnifying glass with a puzzled head tilt, one ear flopped; a small empty thought bubble with a '?' shape above her head (the '?' is the only symbol allowed).
skills:    She hugs a sparkly pastel notebook with a little star charm, tiny four-point sparkles around it, eyes shining with anticipation.
workshop:  She wears a small craftsman bandana, holds a cute pink toolbox in one hand and makes a determined little fist with the other, confident smile.
```

---

## C. 桌宠新姿势（可选 · 下一阶段接入）

这一组需要我在桌宠渲染器里新增状态，图交给我之后再接。用途如下：

- `stand-notebook`：她在安排日程、工坊在后台干活时，拿着手账站着。
- `stand-clock`：提醒到点时，举着闹钟提醒你。
- `stand-wave`：早安、欢迎回来时挥手打招呼。

**必须严格对齐现有站姿**，否则切换时人物会跳动：

- 画布：508 × 1000，透明背景。不裁切、不居中重排、不缩放。
- 比例：和 `ich01A_101.png` 同一身高、同一位置。头顶约在 y≈5，双脚落地线在 **y = 969**，身体中线约在 **x ≈ 254**。
- 生成时把 `ich01A_101.png` 当作编辑底图（edit / reference）效果最好：只改手臂、手里的道具和表情，头、头发、身体轮廓、裙子、腿和脚的位置尽量不动。
- 表情直接画在脸上（完整成图）。不要留空白脸，也不要另出差分。

```text
Use case: precise-object-edit. The supplied PNG (ich01A_101.png, 508x1000, transparent) is the EXACT edit target. Keep the canvas 508x1000 with no recentering, no zoom, no crop; the head, hair silhouette, ears, body, skirt, legs and stocking feet stay where they are (feet resting on the same ground line at y=969). Change ONLY the arms/hands, add the prop described, and adjust the facial expression as described.
<POSE>
Hands must be small, soft and natural with five fingers, rounded fingertips, no extra joints. Keep the same pastel lineart and very light shading, bright face without added shadows. Genuine clean alpha, no background, no ground shadow, no text.
[paste the CHARACTER + STYLE block here]
```

`<POSE>` 逐条：

```text
stand-notebook: She holds a small pink notebook open against her chest with her left arm and a little pen in her right hand raised near her chin, as if thinking about a schedule; eyes looking slightly up-left, gentle focused smile.
stand-clock:    She holds a small round pink alarm clock up beside her face with both hands, showing it to the viewer; eyebrows slightly raised, cheerful "it's time!" expression with a small open mouth.
stand-wave:     She waves at the viewer with her right hand raised beside her head (palm open, fingers relaxed), the left hand resting lightly on the apron; bright happy smile with eyes softly curved.
```

---

## 交付检查清单

- [ ] 透明通道正确：放在黑底和白底上看，白色头发、袜子、贴纸白边的边缘都没有灰边或白边。
- [ ] 尺寸与文件名和上面的表格完全一致。
- [ ] 犬耳是**垂耳**，不是兔耳；不穿鞋；没有文字。
- [ ] C 组：把新图和 `ich01A_101.png` 叠在一起对照，脚和头的位置要重合。

A 组和 B 组放进对应文件夹后，重启程序即可看到。C 组交给我之后，我来接进桌宠的动作状态机。
