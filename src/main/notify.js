// Interactive notifications: sticky-note cards on the character (and in the notebook),
// optionally mirrored to Windows notifications. Cards resolve through `card.action`.
import { Notification } from 'electron';
import path from 'node:path';
import { rpc, broadcast, bus } from './bus.js';
import { settings } from './settings.js';
import { assetsDir } from './paths.js';
import { uid } from './store.js';

const open = new Map(); // id -> { card, resolve, timer }

/** Show a card; resolves with the chosen action id ('dismiss' when closed / timed out). */
export function showCard(card, { timeoutMs = 0, system = false } = {}) {
  const id = card.id || uid('card_');
  const full = { ...card, id, ts: Date.now() };
  return new Promise((resolve) => {
    const prev = open.get(id);
    if (prev) { clearTimeout(prev.timer); prev.resolve('replaced'); }
    const entry = { card: full, resolve };
    if (timeoutMs > 0) entry.timer = setTimeout(() => finish(id, 'timeout'), timeoutMs);
    open.set(id, entry);
    broadcast('notify:card', full);
    const petHidden = !settings.get('pet.visible');
    if ((system || petHidden) && settings.get('planner.systemNotifications') && Notification.isSupported()) {
      try {
        const n = new Notification({ title: full.title || '御园莓华', body: full.body || '', icon: path.join(assetsDir(), 'app', 'icon.png'), silent: false });
        n.on('click', () => bus.emit('panel:open', 'today'));
        n.show();
      } catch { /* ignore */ }
    }
  });
}

function finish(id, action) {
  const e = open.get(id);
  if (!e) return false;
  clearTimeout(e.timer);
  open.delete(id);
  broadcast('notify:dismiss', { id });
  e.resolve(action);
  return true;
}

export const dismissCard = (id) => finish(id, 'dismiss');
export const openCards = () => [...open.values()].map((e) => e.card);

export function registerNotifyRpc() {
  rpc('card.action', ({ id, action }) => finish(id, action || 'dismiss'));
  rpc('card.list', () => openCards());
}

/**
 * Ask the user to approve an action. Resolves true/false.
 * req: { title, body, code, tool, kind }
 */
export async function approve(req, { timeoutMs = 5 * 60 * 1000 } = {}) {
  const action = await showCard({
    kind: 'approval', label: req.label || '需要你的确认', title: req.title, body: req.body, code: req.code,
    actions: [{ id: 'allow', label: req.allowLabel || '允许', style: 'primary' }, { id: 'deny', label: '拒绝', style: 'danger' }],
    dismissible: false, source: req.source,
  }, { timeoutMs });
  return action === 'allow';
}
