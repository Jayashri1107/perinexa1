// Puts the pathology rate list (src/billing/pathologyRates.js) into every hospital's price list and says what
// changed. From the project folder: npm run load:lab-rates (safe to run again).
// Everything it does is in src/billing/loadLabRates.js.
import mongoose from 'mongoose';
import { config } from '../src/config.js';
import { loadLabRates } from '../src/billing/loadLabRates.js';

await mongoose.connect(config.MONGO_URI);
const done = await loadLabRates();
if (!done.length) console.log('No hospital yet. Nothing changed.');
for (const h of done) console.log(`${h.hospital}: ${h.changed} price(s) changed, ${h.added} lab item(s) added, ${h.unchanged} already right`);
await mongoose.disconnect();
