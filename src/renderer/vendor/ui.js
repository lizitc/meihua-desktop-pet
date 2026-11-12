// Preact + htm binding used by every renderer page.
import { h, render, Fragment, createContext, cloneElement } from './preact.js';
import htm from './htm.js';
export * from './preact-hooks.js';
export { h, render, Fragment, createContext, cloneElement };
export const html = htm.bind(h);
