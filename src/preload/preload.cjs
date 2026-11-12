// Shared, minimal bridge for every renderer: invoke RPC, send messages, receive events.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const listeners = new Map();
ipcRenderer.on('evt', (_e, name, payload) => {
  const set = listeners.get(name);
  if (set) for (const fn of set) { try { fn(payload); } catch (err) { console.error(err); } }
  const any = listeners.get('*');
  if (any) for (const fn of any) { try { fn(name, payload); } catch (err) { console.error(err); } }
});

contextBridge.exposeInMainWorld('meihua', {
  invoke: (name, ...args) => ipcRenderer.invoke('rpc', name, args),
  send: (name, payload) => ipcRenderer.send('msg', name, payload),
  on(name, fn) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
    return () => listeners.get(name)?.delete(fn);
  },
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  platform: process.platform,
});
