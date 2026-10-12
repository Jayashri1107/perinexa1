// Takes one hospital's data out of Perinexa into a folder – for the person who runs the server only (there is no web
// page for it, on purpose). From the project folder:
//   npm run export:hospital -- --hospital "<exact hospital name>" --out "<folder>"
// The folder must be outside the project folder and new or empty; the hospital's name is typed again to confirm.
// Everything it does is in src/export/hospitalExport.js (README.md: "Taking a hospital's data out").
import { createInterface } from 'node:readline/promises';
import mongoose from 'mongoose';
import { config } from '../src/config.js';
import { runExportCommand } from '../src/export/hospitalExport.js';

// Ctrl+C stops the export; what was written is then removed again.
const stop = new AbortController();
process.on('SIGINT', () => stop.abort());

/** The operator's answer to one question ('' when stopped with Ctrl+C). */
async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on('SIGINT', () => stop.abort());
  try {
    return await rl.question(question, { signal: stop.signal });
  } catch {
    return '';
  } finally {
    rl.close();
  }
}

const code = await runExportCommand({
  argv: process.argv.slice(2),
  // npm runs the script from the project folder: a relative --out is taken from where the command was typed
  cwd: process.env.INIT_CWD || process.cwd(),
  connect: () => mongoose.connect(config.MONGO_URI),
  ask,
  signal: stop.signal,
});
await mongoose.disconnect();
process.exit(code);
