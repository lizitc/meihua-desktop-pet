// Evaluated before any other main-process module (imported first by main.js), so the
// self-test can redirect userData before settings are loaded.
import { app } from 'electron';
import path from 'node:path';

const arg = process.argv.find((a) => a.startsWith('--selftest='));
if (arg) app.setPath('userData', path.join(path.resolve(arg.slice('--selftest='.length)), 'userdata'));
// --data-dir=<path>: keep all data in a custom folder (second profile, portable use)
const dataDir = process.argv.find((a) => a.startsWith('--data-dir='));
if (!arg && dataDir) app.setPath('userData', path.resolve(dataDir.slice('--data-dir='.length)));
