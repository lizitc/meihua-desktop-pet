// Hand-drawn style line icons (24×24, currentColor) shared by the overlay UI.
import { html } from '../vendor/ui.js';

const S = (children, cls = '') => html`<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${children}</svg>`;

export const ICON = {
  food: S(html`<path d="M4 12.5h16a8 8 0 0 1-16 0z"/><path d="M9 8.6c0-1.6 1.6-1.6 1.6-3.2M13.4 8.6c0-1.6 1.6-1.6 1.6-3.2"/><path d="M8 20.5h8"/>`),
  stamp: S(html`<path d="M12 3.6c1.9 0 3.2 1.4 3.2 3.2 0 2-1.6 2.8-1.6 4.7h-3.2c0-1.9-1.6-2.7-1.6-4.7 0-1.8 1.3-3.2 3.2-3.2z"/><rect x="4.5" y="11.5" width="15" height="4.2" rx="1.4"/><path d="M6 19.5h12"/>`),
  heart: S(html`<path d="M12 19.6s-7.5-4.4-7.5-9.6A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 7.5 2.4c0 5.2-7.5 9.6-7.5 9.6z"/>`),
  star: S(html`<path d="M12 3.8l2.4 5 5.4.7-4 3.7 1 5.4-4.8-2.6-4.8 2.6 1-5.4-4-3.7 5.4-.7z"/>`),
  chat: S(html`<path d="M5 5.5h14a2.5 2.5 0 0 1 2.5 2.5v7a2.5 2.5 0 0 1-2.5 2.5h-7.5l-4.5 3.4v-3.4H5A2.5 2.5 0 0 1 2.5 15V8A2.5 2.5 0 0 1 5 5.5z"/><circle cx="8" cy="11.6" r=".9" fill="currentColor" stroke="none"/><circle cx="12" cy="11.6" r=".9" fill="currentColor" stroke="none"/><circle cx="16" cy="11.6" r=".9" fill="currentColor" stroke="none"/>`),
  notebook: S(html`<rect x="5.5" y="3.5" width="14" height="17" rx="2.5"/><path d="M5.5 8H3.8M5.5 12H3.8M5.5 16H3.8"/><path d="M12.5 10.3c-.9-1.5-3.2-1-3.2.8 0 1.6 2 2.7 3.2 3.6 1.2-.9 3.2-2 3.2-3.6 0-1.8-2.3-2.3-3.2-.8z"/>`),
  calendar: S(html`<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="12" cy="15.2" r="1.6" fill="currentColor" stroke="none"/>`),
  paw: S(html`<path d="M12 12.2c2.6 0 4.6 2.2 4.6 4.3 0 1.8-1.5 2.6-2.8 2.6-.8 0-1.2-.4-1.8-.4s-1 .4-1.8.4c-1.3 0-2.8-.8-2.8-2.6 0-2.1 2-4.3 4.6-4.3z"/><ellipse cx="6.4" cy="10.6" rx="1.6" ry="2"/><ellipse cx="9.8" cy="6.6" rx="1.6" ry="2.1"/><ellipse cx="14.2" cy="6.6" rx="1.6" ry="2.1"/><ellipse cx="17.6" cy="10.6" rx="1.6" ry="2"/>`),
  pawPrint: html`<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 11.6c2.9 0 5.1 2.4 5.1 4.8 0 2-1.7 2.9-3.1 2.9-.9 0-1.3-.4-2-.4s-1.1.4-2 .4c-1.4 0-3.1-.9-3.1-2.9 0-2.4 2.2-4.8 5.1-4.8z"/><ellipse cx="6.2" cy="10.2" rx="1.8" ry="2.2"/><ellipse cx="9.7" cy="5.9" rx="1.8" ry="2.3"/><ellipse cx="14.3" cy="5.9" rx="1.8" ry="2.3"/><ellipse cx="17.8" cy="10.2" rx="1.8" ry="2.2"/></svg>`,
  moon: S(html`<path d="M19.5 14.6A7.8 7.8 0 0 1 9.4 4.5a7.9 7.9 0 1 0 10.1 10.1z"/><path d="M16.5 3.5v2.6M15.2 4.8h2.6"/>`),
  steps: S(html`<path d="M8 3.6c1.6 0 2.5 1.9 2.3 4.2-.2 1.9-1 3.1-2.3 3.1S5.9 9.7 5.7 7.8C5.5 5.5 6.4 3.6 8 3.6zM6.2 13.6h3.6"/><path d="M16 9.6c1.6 0 2.5 1.9 2.3 4.2-.2 1.9-1 3.1-2.3 3.1s-2.1-1.2-2.3-3.1c-.2-2.3.7-4.2 2.3-4.2zM14.2 19.6h3.6"/>`),
  pin: S(html`<path d="M9 3.5h6l-1 5 3 3v1.6H7v-1.6l3-3z"/><path d="M12 13.1v7.4"/>`),
  gear: S(html`<circle cx="12" cy="12" r="2.8"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6"/><circle cx="12" cy="12" r="6.3"/>`),
  eyeOff: S(html`<path d="M3 12s3.4-6 9-6 9 6 9 6-3.4 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="2.6"/><path d="M4.5 4.5l15 15"/>`),
  back: S(html`<path d="M9.5 5.5l-6 6 6 6M4 11.5h10.2a6 6 0 0 1 6 6v1"/>`),
  stand: S(html`<circle cx="12" cy="4.8" r="2.3"/><path d="M12 7.6v7M12 14.6l-3 6M12 14.6l3 6M7.6 10.4h8.8"/>`),
  sit: S(html`<circle cx="9" cy="5" r="2.3"/><path d="M9 7.8v6.7h6.4l1.3 6M9 10.6l4 1.5M4.5 20.5h15"/>`),
  wave: S(html`<path d="M9.2 12.4V6.2a1.4 1.4 0 0 1 2.8 0v5M12 11V4.6a1.4 1.4 0 0 1 2.8 0V11M14.8 11V6a1.4 1.4 0 0 1 2.8 0v7.4c0 4-2.6 6.8-6.2 6.8-2.4 0-3.8-1.2-5.2-3.4l-2-3.3a1.4 1.4 0 0 1 2.3-1.6l1.7 2"/><path d="M3.6 6.4c.4-1.4 1.3-2.5 2.6-3.1M19.8 3.4c1 .7 1.6 1.7 1.8 2.9"/>`),
  sleep: S(html`<path d="M3.5 14.5V20.5M3.5 17h17v3.5M8 17v-1.5a2 2 0 0 1 2-2h8.5a2 2 0 0 1 2 2V17"/><circle cx="6.3" cy="14.4" r="1.6"/><path d="M14 3.8h4l-4 4h4M9.4 7.4h2.6l-2.6 2.6H12"/>`),
  come: S(html`<path d="M3.5 12h11.5M10.5 7l5 5-5 5"/><path d="M20 5v14"/>`),
  hop: S(html`<path d="M4 18.5c2-7.5 5.4-11 8-11s6 3.5 8 11"/><circle cx="12" cy="4.8" r="2"/><path d="M3 20.6h18"/>`),
  spin: S(html`<path d="M19.6 12a7.6 7.6 0 1 1-2.2-5.4"/><path d="M19.8 4v4.4h-4.4"/>`),
  close: S(html`<path d="M7 7l10 10M17 7L7 17"/>`),
  tool: S(html`<path d="M14.6 4.4a4.5 4.5 0 0 0-5.3 5.9L3.9 15.7a2 2 0 0 0 2.8 2.8l5.4-5.4a4.5 4.5 0 0 0 5.9-5.3L15.2 10.6l-2.6-.6-.6-2.6z"/>`),
  mic: S(html`<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>`),
  send: S(html`<path d="M3.5 11.4L20.5 4l-6 16.5-3.2-6.8z"/><path d="M11.3 13.7L20.5 4"/>`),
  berry: html`<svg class="ico berry" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7.6c4.4 0 7 2.3 7 5.5 0 4-3.6 7.3-7 8.3-3.4-1-7-4.3-7-8.3 0-3.2 2.6-5.5 7-5.5z" fill="currentColor"/><path d="M12 7.8c-1.5-1.8-3.7-2.3-5.1-1.6 1.2.4 2.3 1.2 2.9 2.1M12 7.8c1.5-1.8 3.7-2.3 5.1-1.6-1.2.4-2.3 1.2-2.9 2.1M12 7.8V4.2" fill="none" stroke="#3f9b78" stroke-width="1.7" stroke-linecap="round"/><g fill="#fff3c4"><circle cx="9.3" cy="12" r=".7"/><circle cx="12" cy="11.2" r=".7"/><circle cx="14.7" cy="12" r=".7"/><circle cx="10.6" cy="14.8" r=".7"/><circle cx="13.4" cy="14.8" r=".7"/><circle cx="12" cy="17.6" r=".7"/></g></svg>`,
  bell: S(html`<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>`),
  shield: S(html`<path d="M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z"/><path d="M9 12l2.2 2.2 4.3-4.2"/>`),
  ask: S(html`<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.7-.9 1.3v.6"/><circle cx="12" cy="16.6" r=".9" fill="currentColor" stroke="none"/>`),
  note: S(html`<path d="M5 4h14v10l-5 6H5z"/><path d="M14 20v-6h5"/>`),
};
