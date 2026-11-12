// Assembles the Codex prompt files for the sit / sleep redraw from prompts/blocks.md + one task per drawing.
//   node art/sit-kit/tools/make-prompts.mjs <task> [<task> ...]   -> art/sit-kit/prompts/<task>.txt
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.resolve(here, '..');
const REFS = path.join(KIT, 'refs');
const OUT = path.join(KIT, 'out');
const raw = fs.readFileSync(path.join(KIT, 'prompts', 'blocks.md'), 'utf8');
const block = (name) => raw.split(`[${name}]`)[1].split(/\n\[[A-Z]+\]\n/)[0].trim();
const ref = (f) => path.join(REFS, f);
const out = (f) => path.join(OUT, f);

const TASKS = {
  // the sitting pose, restyled to the standing art (same pose, outline, size and place)
  S: {
    images: [ref('sit-green.png'), ref('stand-green.png'), ref('ich01A_101.png')],
    roles: [
      'Image 1 = THE IMAGE TO EDIT: the current sitting drawing (off-model: her face and eyes are drawn in a different style).',
      'Image 2 = the approved standing art on the same canvas and at the same scale: the target for identity, face, line, shading and colour.',
      'Image 3 = the character model sheet (identity reference only).',
    ],
    task: `Edit image 1. Keep her sitting pose, the outline of the figure, its size and its place on the canvas exactly (every part within a few pixels): the head position and its slight tilt, both ears, the whole hair mass and the side bunches, the arms going down between her knees with both hands resting on the floor in front, the skirt and apron spread on the floor, the legs folded to both sides (girl sitting / wariza) with the stocking feet showing, and the tail on the screen-right side.
Change only HOW she is drawn, so that she looks exactly like the girl in image 2: the same face (in image 1 the eyes are much too large and too round; make them exactly the size, shape and spacing of the eyes in image 2), the same thin lineart and soft cel shading, the same hair rendering and the same outfit colours and details. The navy and peach bows stay on the screen-right ear only. Keep her expression a calm, gentle little smile looking at the viewer.`,
    tries: 3,
    files: ['S-try-1.png', 'S-try-2.png', 'S-try-3.png'],
  },
  // first in-between from the standing art toward sitting down
  K1: {
    images: [ref('stand-green.png'), ref('sit-green.png'), ref('ich01A_101.png')],
    roles: [
      'Image 1 = THE IMAGE TO EDIT: the approved standing art.',
      'Image 2 = where this motion ends: she sits on the floor (pose reference only; its face is off-model, keep the face of image 1).',
      'Image 3 = the character model sheet (identity reference only).',
    ],
    task: `Edit image 1 into the first drawing of her sitting down onto the floor. She has just started to lower herself: both knees bend forward (about 25 degrees at the knee, knees together), her hips go down so the top of her headband is about 80 px lower than in image 1, the upper body leans forward slightly (about 8 degrees), her head tilts down a little and she glances down at the floor in front of her. Her hands have let go of the skirt hem and move to the front of her thighs, just above the knees. Both stocking feet stay flat on the ground line exactly where they are in image 1. The skirt hangs naturally over the bent thighs. Everything that is not listed stays identical to image 1: face, hair, ears and bows, tail, clothes, colours, line and scale.`,
    tries: 3,
    files: ['K1-try-1.png', 'K1-try-2.png', 'K1-try-3.png'],
  },
  // the lying pose, restyled to the standing art
  Z: {
    images: [ref('sleep-green.png'), ref('stand-green.png'), ref('ich01A_101.png')],
    roles: [
      'Image 1 = THE IMAGE TO EDIT: the current sleeping drawing (off-model: drawn in a slightly different style).',
      'Image 2 = the approved standing art on the same canvas and at the same scale: the target for identity, line, shading and colour.',
      'Image 3 = the character model sheet (identity reference only).',
    ],
    task: `Edit image 1. Keep her sleeping pose, the outline of the figure, its size and its place on the canvas exactly (every part within a few pixels): she lies curled on her side on the floor, head on the screen-left resting on her folded arms, eyes closed, legs bent to the screen-right, tail on the right, hair spread around.
Change only HOW she is drawn, so that she looks exactly like the girl in image 2: the same face proportions (closed eyes drawn as soft curved lash lines in the style of image 2), the same thin lineart and soft cel shading, the same hair rendering and the same outfit colours and details. The navy and peach bows stay on the ear on the screen-right side of her head as in image 1. Peaceful sleeping face with a light blush.`,
    tries: 3,
    files: ['Z-try-1.png', 'Z-try-2.png', 'Z-try-3.png'],
  },
  // ---- batch 2: the remaining in-betweens, each an edit of its nearest approved neighbour
  // stand -> K1 -> K2 -> K3 -> S (sit down), S -> L1 -> L2 -> Z (lie down to sleep)
  K2: {
    images: [out('K1-try-2.png'), out('S-try-2.png'), ref('stand-green.png')],
    roles: [
      'Image 1 = THE IMAGE TO EDIT: the approved previous drawing of this motion (she has just started to bend her knees).',
      'Image 2 = the approved drawing where this motion ends: sitting on the floor (pose target, same outfit).',
      'Image 3 = the approved standing art (identity, face and style reference).',
    ],
    task: `Edit image 1 into the next drawing of her sitting down onto the floor (halfway between image 1 and image 2). She lowers herself much further: her knees bend strongly (about 100 degrees) and come forward and down until they almost touch the floor, knees together, her lower legs angled back beneath her with the stocking feet on the ground line (toes pointing to the viewer, heels slightly apart), her hips are above her heels, about 260 px lower than in image 1 (the top of her headband about 260 px lower). The upper body stays almost upright, leaning forward only a little; her hands rest on top of her knees; her head tilts down slightly and she looks down at the floor in front of her. The skirt and apron fan out over her thighs, the tail hangs to the screen-right side. Everything not listed stays identical to image 1: face, eyes, hair, ears and bows, clothes, colours, line and head size.`,
    tries: 3,
    files: ['K2-try-1.png', 'K2-try-2.png', 'K2-try-3.png'],
  },
  K3: {
    images: [out('S-try-2.png'), out('K1-try-2.png'), ref('stand-green.png')],
    roles: [
      'Image 1 = THE IMAGE TO EDIT: the approved sitting drawing (the end of this motion).',
      'Image 2 = an approved earlier drawing of this motion: she is bending her knees to sit down (pose reference only).',
      'Image 3 = the approved standing art (identity, face and style reference).',
    ],
    task: `Edit image 1 into the drawing just before she settles into this sitting pose. Her knees are already on the floor exactly where they are in image 1 and her lower legs are folded to both sides as in image 1, but her hips have not reached the floor yet: her whole upper body and head are about 120 px higher than in image 1 (the top of her headband about 120 px higher), the torso upright. Her arms are not reaching to the floor yet: both hands rest on the front of her thighs, just above the knees, elbows slightly bent. The skirt and apron hang from her raised hips and only touch the floor at their frilled hem. Same calm face looking slightly down, ears, bows, hair, tail, clothes, colours, line and head size identical to image 1.`,
    tries: 3,
    files: ['K3-try-1.png', 'K3-try-2.png', 'K3-try-3.png'],
  },
  L1: {
    images: [out('S-try-2.png'), out('Z-try-2.png'), ref('stand-green.png')],
    roles: [
      'Image 1 = THE IMAGE TO EDIT: the approved sitting drawing (the start of this motion).',
      'Image 2 = the approved drawing where this motion ends: she lies asleep on the floor (pose target).',
      'Image 3 = the approved standing art (identity, face and style reference).',
    ],
    task: `Edit image 1 into the first drawing of her getting sleepy and lying down. Her legs stay folded on the floor exactly as in image 1. Her upper body leans over to the SCREEN-LEFT side and down, about 35 degrees from upright, as if she is about to lie down on that side: her screen-left forearm is placed flat on the floor in front of her screen-left knee to support her, her other hand rests on her lap, her head tilts toward the screen-left, her eyes are half closed and drowsy with a soft sleepy smile and a light blush. The long hair follows the lean and spills onto the floor on the screen-left. Ears, bows, tail, clothes, colours, line and head size identical to image 1. The lowest point of the figure stays on the ground line.`,
    tries: 3,
    files: ['L1-try-1.png', 'L1-try-2.png', 'L1-try-3.png'],
  },
  L2: {
    images: [out('Z-try-2.png'), out('S-try-2.png'), ref('stand-green.png')],
    roles: [
      'Image 1 = THE IMAGE TO EDIT: the approved sleeping drawing (the end of this motion).',
      'Image 2 = the approved sitting drawing where this motion starts (pose reference only).',
      'Image 3 = the approved standing art (identity, face and style reference).',
    ],
    task: `Edit image 1 into the drawing just before she falls asleep. Her legs, skirt, tail and the position of her body on the floor stay as in image 1, but her head and shoulders are still raised: she props herself on her folded forearms, so her head is about 90 px higher than in image 1 and tilted, not yet resting on her arms. Her eyes are almost closed (drowsy, a thin line of violet still showing), a sleepy little yawn-free smile and a light blush. Hair, ears, bows, clothes, colours, line and head size identical to image 1. The lowest point of the figure stays on the ground line.`,
    tries: 3,
    files: ['L2-try-1.png', 'L2-try-2.png', 'L2-try-3.png'],
  },
};

export function promptFor(id, t = TASKS[id]) {
  const lines = [
    'You are producing one drawing for a desktop-pet animation of the character below. Use your built-in image generation tool in EDIT mode with the attached images, which are passed in this order:',
    ...t.roles,
    '',
    block('CHARACTER'),
    '',
    'TASK:',
    t.task,
    '',
    block('TECH'),
    '',
    `Make ${t.tries} separate attempts (${t.tries} separate image generation calls, each one an edit of image 1 with the same references), so the best one can be chosen. Save them as:`,
    ...t.files.map((f) => `- ${out(f)}`),
    '',
    block('SAVE'),
  ];
  return lines.join('\n');
}

export const TASK_IMAGES = (id) => TASKS[id].images;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(OUT, { recursive: true });
  for (const id of process.argv.slice(2)) {
    if (!TASKS[id]) { console.error('unknown task', id); process.exitCode = 1; continue; }
    const f = path.join(KIT, 'prompts', `${id}.txt`);
    fs.writeFileSync(f, promptFor(id), 'utf8');
    console.log(id, f, '\n  images:', TASKS[id].images.join(' | '));
  }
}
