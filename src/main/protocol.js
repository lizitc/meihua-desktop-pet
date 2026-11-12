// meihua://app/renderer/...  -> src/renderer
// meihua://app/assets/...    -> character & app assets
// meihua://app/user/...      -> whitelisted user data (extension UI, exported files)
import { protocol, net } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RENDERER_DIR, assetsDir, safeJoin, userDir } from './paths.js';

export const SCHEME = 'meihua';
export const appUrl = (p) => `${SCHEME}://app/${p.replace(/^\/+/, '')}`;

export function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
  ]);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.md': 'text/markdown; charset=utf-8',
};

export function handleProtocol() {
  const roots = { renderer: RENDERER_DIR, assets: assetsDir(), user: userDir('public') };
  protocol.handle(SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      const [, top, ...rest] = decodeURIComponent(url.pathname).split('/');
      const root = roots[top];
      if (!root) return new Response('not found', { status: 404 });
      const file = safeJoin(root, rest.join('/'));
      if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response('not found', { status: 404 });
      const res = await net.fetch(pathToFileURL(file).toString());
      const headers = new Headers(res.headers);
      headers.set('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
      headers.set('Access-Control-Allow-Origin', '*');
      if (top === 'assets') headers.set('Cache-Control', 'max-age=31536000, immutable');
      else headers.set('Cache-Control', 'no-cache');
      return new Response(res.body, { status: 200, headers });
    } catch (err) {
      return new Response(String(err?.message || err), { status: 500 });
    }
  });
}
