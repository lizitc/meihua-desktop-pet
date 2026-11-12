// Copies browser ESM builds of UI libraries into src/renderer/vendor (no bundler needed).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NM = path.join(APP, 'node_modules');
const OUT = path.join(APP, 'src', 'renderer', 'vendor');
fs.mkdirSync(OUT, { recursive: true });

const copy = (from, to, transform = (s) => s) => {
  const src = fs.readFileSync(path.join(NM, from), 'utf8');
  fs.writeFileSync(path.join(OUT, to), transform(src));
  console.log('vendor', to);
};
const stripMap = (s) => s.replace(/\/\/# sourceMappingURL=.*$/gm, '');
copy('preact/dist/preact.module.js', 'preact.js', stripMap);
copy('preact/hooks/dist/hooks.module.js', 'preact-hooks.js', (s) => stripMap(s).replace(/from\s*["']preact["']/g, 'from"./preact.js"'));
copy('htm/dist/htm.module.js', 'htm.js', stripMap);
copy('marked/lib/marked.esm.js', 'marked.js', stripMap);
copy('dompurify/dist/purify.es.mjs', 'purify.js', stripMap);
fs.writeFileSync(path.join(OUT, 'ui.js'), `// Preact + htm binding used by every renderer page.
import { h, render, Fragment, createContext, cloneElement } from './preact.js';
import htm from './htm.js';
export * from './preact-hooks.js';
export { h, render, Fragment, createContext, cloneElement };
export const html = htm.bind(h);
`);
console.log('vendor ui.js');
