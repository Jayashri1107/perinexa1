// Reads the project settings: config/default.json (committed, no secrets) merged with config/local.json
// (this computer only, git-ignored: secrets and local overrides). Used by the server and by Vite.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function deepMerge(base, extra) {
  const out = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return out;
}

function readJson(fileName, required) {
  const file = path.join(CONFIG_DIR, fileName);
  if (!existsSync(file)) {
    if (required) throw new Error(`Missing config file: ${file}`);
    return {};
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function loadConfig() {
  return deepMerge(readJson('default.json', true), readJson('local.json', false));
}
