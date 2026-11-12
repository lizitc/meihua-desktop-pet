// App-wide event bus + RPC registry shared by all main-process services.
import { EventEmitter } from 'node:events';
import { BrowserWindow, ipcMain } from 'electron';

export const bus = new EventEmitter();
bus.setMaxListeners(100);

const handlers = new Map();

/** Register an RPC method callable from renderers via window.meihua.invoke(name, ...args). */
export function rpc(name, fn) {
  handlers.set(name, fn);
}

export function installRpc() {
  ipcMain.handle('rpc', async (event, name, args) => {
    const fn = handlers.get(name);
    if (!fn) throw new Error(`未知调用: ${name}`);
    return fn(...(Array.isArray(args) ? args : []), { sender: event.sender });
  });
  // fire-and-forget messages (high frequency, e.g. pet root position)
  ipcMain.on('msg', (event, name, payload) => {
    const fn = handlers.get(name);
    if (fn) {
      try { fn(payload, { sender: event.sender }); } catch (err) { console.error('[msg]', name, err); }
    }
  });
}

/** Broadcast an event to every renderer window. */
export function broadcast(name, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('evt', name, payload);
  }
}

export function sendTo(win, name, payload) {
  if (win && !win.isDestroyed()) win.webContents.send('evt', name, payload);
}
