// Touch areas of each pose (manifest.parts): ellipses on the rig grid (native px), checked in Character.partAt's
// order. `phrase` is her line for a single touch; strokes over a part are answered by Behavior.onRub (RUB table).
//   node scripts/parts.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(here, '..', 'assets', 'character', 'manifest.json');

const P = (id, cx, cy, rx, ry, label, phrase, extra = {}) => ({ id, cx, cy, rx, ry, px: cx, py: cy - ry, label, phrase, ...extra });
const LINES = {
  'ear-left': '耳、耳朵很敏感的……轻一点嘛。',
  'ear-right': '蝴蝶结要被碰歪啦……',
  head: '嘿嘿……最喜欢被{name}摸头了。',
  face: '诶？脸、脸会变红的啦……',
  chest: '呀！那、那里不可以随便碰啦……',
  body: '呜哇，好痒！',
  hair: '要帮我梳头发吗？',
  'hand-left': '要牵手吗？……嗯！',
  'hand-right': '{name}的手好暖和～',
  skirt: '裙、裙子不可以掀！',
  'thigh-left': '大、大腿不行啦……{name}好坏。',
  'thigh-right': '呜……不要一直盯着腿看嘛。',
  'calf-left': '小腿也会痒的啦～',
  'calf-right': '嘻嘻，好痒……',
  'foot-left': '脚、脚最怕痒了！',
  'foot-right': '不、不要挠脚心啦！',
  tail: '尾巴自己摇起来了……才不是因为开心呢！',
};
const L = (id) => LINES[id];

const parts = {
  stand: [
    P('ear-left', 149, 83, 47, 53, '左耳', L('ear-left'), { kind: 'rotate', gain: 0.38, px: 184, py: 34 }),
    P('ear-right', 315, 91, 41, 55, '右耳', L('ear-right'), { kind: 'rotate', gain: -0.38, px: 302, py: 32 }),
    P('head', 238, 92, 72, 54, '头顶', L('head'), { kind: 'nod', gain: 4, px: 240, py: 60 }),
    P('face', 238, 186, 46, 38, '脸颊', L('face'), { kind: 'nod', gain: 2 }),
    P('chest', 238, 330, 56, 40, '胸口', L('chest'), { kind: 'breath', gain: 2 }),
    P('hair', 394, 410, 74, 185, '长发', L('hair'), { kind: 'sway', gain: 8, px: 352, py: 205 }),
    P('hair', 90, 408, 73, 184, '长发', L('hair'), { kind: 'sway', gain: 8, px: 140, py: 204 }),
    P('hand-left', 74, 573, 24, 24, '左手', L('hand-left'), { kind: 'rotate', gain: 0.5, px: 88, py: 548 }),
    P('hand-right', 382, 575, 34, 29, '右手', L('hand-right'), { kind: 'rotate', gain: -0.5, px: 357, py: 547 }),
    P('skirt', 237, 570, 157, 69, '裙摆', L('skirt'), { kind: 'cloth', gain: 8, px: 239, py: 488 }),
    P('thigh-left', 210, 690, 30, 54, '大腿', L('thigh-left'), { kind: 'bend', gain: 5 }),
    P('thigh-right', 282, 690, 34, 54, '大腿', L('thigh-right'), { kind: 'bend', gain: -5 }),
    P('calf-left', 212, 830, 28, 60, '小腿', L('calf-left'), { kind: 'bend', gain: 7 }),
    P('calf-right', 300, 820, 32, 60, '小腿', L('calf-right'), { kind: 'bend', gain: -7 }),
    P('foot-left', 222, 937, 28, 36, '左脚', L('foot-left'), { kind: 'rotate', gain: 0.42, px: 224, py: 899 }),
    P('foot-right', 344, 923, 31, 43, '右脚', L('foot-right'), { kind: 'rotate', gain: -0.42, px: 340, py: 879 }),
    P('tail', 375, 624, 43, 29, '尾巴', L('tail'), { kind: 'rotate', gain: 0.4, px: 343, py: 611 }),
    P('body', 237, 392, 72, 98, '腰', L('body'), { kind: 'breath', gain: 3, px: 239, py: 303 }),
  ],
  sit: [
    P('ear-left', 189, 87, 28, 42, '左耳', L('ear-left'), { kind: 'rotate', gain: 0.38, px: 218, py: 46 }),
    P('ear-right', 290, 80, 25, 41, '右耳', L('ear-right'), { kind: 'rotate', gain: -0.38, px: 282, py: 42 }),
    P('head', 250, 66, 56, 38, '头顶', L('head'), { kind: 'nod', gain: 4, px: 252, py: 40 }),
    P('face', 246, 125, 38, 30, '脸颊', L('face'), { kind: 'nod', gain: 2 }),
    P('chest', 246, 196, 44, 28, '胸口', L('chest'), { kind: 'breath', gain: 2 }),
    P('hair', 329, 214, 44, 92, '长发', L('hair'), { kind: 'sway', gain: 8, px: 300, py: 137 }),
    P('hair', 162, 227, 39, 86, '长发', L('hair'), { kind: 'sway', gain: 8, px: 203, py: 139 }),
    P('hand-left', 204, 346, 20, 16, '左手', L('hand-left'), { kind: 'rotate', gain: 0.5, px: 211, py: 323 }),
    P('hand-right', 231, 347, 19, 16, '右手', L('hand-right'), { kind: 'rotate', gain: -0.5, px: 238, py: 323 }),
    P('thigh-left', 200, 300, 40, 22, '大腿', L('thigh-left'), { kind: 'bend', gain: 5 }),
    P('thigh-right', 300, 300, 40, 22, '大腿', L('thigh-right'), { kind: 'bend', gain: -5 }),
    P('foot-left', 146, 340, 16, 14, '左脚', L('foot-left'), { kind: 'rotate', gain: 0.42 }),
    P('foot-right', 366, 340, 18, 14, '右脚', L('foot-right'), { kind: 'rotate', gain: -0.42 }),
    P('calf-left', 180, 336, 28, 20, '小腿', L('calf-left'), { kind: 'bend', gain: 7 }),
    P('calf-right', 330, 338, 28, 20, '小腿', L('calf-right'), { kind: 'bend', gain: -7 }),
    P('skirt', 254, 290, 117, 48, '裙摆', L('skirt'), { kind: 'cloth', gain: 8, px: 256, py: 236 }),
    P('tail', 383, 286, 35, 40, '尾巴', L('tail'), { kind: 'rotate', gain: 0.4, px: 352, py: 279 }),
    P('body', 256, 240, 54, 40, '腰', L('body'), { kind: 'breath', gain: 3, px: 256, py: 200 }),
  ],
};
// asleep: any touch wakes her, so the areas only need to tell head / face / body / legs apart
parts.sleep = [
  P('ear-left', 93, 196, 31, 40, '左耳', L('ear-left'), { kind: 'rotate', gain: 0.38 }),
  P('ear-right', 160, 161, 37, 35, '右耳', L('ear-right'), { kind: 'rotate', gain: -0.38 }),
  P('face', 125, 240, 36, 24, '脸颊', L('face'), { kind: 'nod', gain: 2 }),
  P('head', 120, 190, 60, 46, '头顶', L('head'), { kind: 'nod', gain: 4 }),
  P('hair', 148, 315, 85, 36, '长发', L('hair'), { kind: 'sway', gain: 8 }),
  P('hand-left', 157, 282, 25, 18, '左手', L('hand-left'), { kind: 'rotate', gain: 0.5 }),
  P('skirt', 328, 267, 96, 63, '裙摆', L('skirt'), { kind: 'cloth', gain: 8 }),
  P('thigh-left', 316, 334, 63, 25, '大腿', L('thigh-left'), { kind: 'bend', gain: 5 }),
  P('foot-left', 394, 345, 32, 15, '左脚', L('foot-left'), { kind: 'rotate', gain: 0.42 }),
  P('foot-right', 425, 335, 27, 18, '右脚', L('foot-right'), { kind: 'rotate', gain: -0.42 }),
  P('tail', 423, 245, 44, 43, '尾巴', L('tail'), { kind: 'rotate', gain: 0.4 }),
  P('body', 249, 260, 61, 48, '身体', L('body'), { kind: 'breath', gain: 3 }),
];

const m = JSON.parse(fs.readFileSync(FILE, 'utf8'));
for (const k of Object.keys(m.parts)) if (k.includes('@')) delete m.parts[k];
Object.assign(m.parts, parts);
fs.writeFileSync(FILE, JSON.stringify(m, null, 2) + '\n');
console.log('parts:', Object.entries(parts).map(([k, v]) => `${k} ${v.length}`).join(', '));
