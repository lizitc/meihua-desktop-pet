// Local date/time helpers. Stored values are local wall-clock strings:
//   'YYYY-MM-DD' (all-day) or 'YYYY-MM-DDTHH:mm' — never UTC.
const pad = (n) => String(n).padStart(2, '0');
export const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function parseLocal(s) {
  if (s instanceof Date) return new Date(s);
  if (typeof s === 'number') return new Date(s);
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(String(s || '').trim());
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

export const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fmtDateTime = (d) => `${fmtDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const isDateOnly = (s) => /^\d{4}-\d{1,2}-\d{1,2}$/.test(String(s || '').trim());

/** Normalize model/user input like '2026-11-9 9:05' to canonical form. */
export function normalize(s, { dateOnly = false } = {}) {
  const d = parseLocal(s);
  if (!d || Number.isNaN(d.getTime())) return null;
  return dateOnly || isDateOnly(s) ? fmtDate(d) : fmtDateTime(d);
}

export function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function addMinutes(d, n) { return new Date(d.getTime() + n * 60000); }

/** Human readable, relative to now: 今天 15:00 / 明天 09:30 / 11月12日 周三 */
export function human(s, now = new Date()) {
  const d = parseLocal(s);
  if (!d) return String(s || '');
  const days = Math.round((startOfDay(d) - startOfDay(now)) / 86400000);
  const day = days === 0 ? '今天' : days === 1 ? '明天' : days === 2 ? '后天' : days === -1 ? '昨天' : `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}`;
  return isDateOnly(s) ? day : `${day} ${fmtTime(d)}`;
}

export function nowContext(d = new Date()) {
  return `${fmtDate(d)} ${WEEK[d.getDay()]} ${fmtTime(d)}`;
}

/** 'HH:mm' -> minutes since midnight */
export const hm = (s) => { const [h, m] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
export const minutesNow = (d = new Date()) => d.getHours() * 60 + d.getMinutes();
export function inWindow(startHM, endHM, d = new Date()) {
  const a = hm(startHM), b = hm(endHM), n = minutesNow(d);
  return a <= b ? n >= a && n < b : n >= a || n < b;
}
