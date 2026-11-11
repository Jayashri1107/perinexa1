// Puts the service rate list (src/billing/serviceRates.js) into every hospital's price list and says what changed.
// From the project folder: npm run load:service-rates (safe to run again; a price already set is never changed).
// Everything it does is in src/billing/loadServiceRates.js.
import mongoose from 'mongoose';
import { config } from '../src/config.js';
import { loadServiceRates } from '../src/billing/loadServiceRates.js';

await mongoose.connect(config.MONGO_URI);
const done = await loadServiceRates();
if (!done.length) console.log('No hospital yet. Nothing changed.');
for (const h of done) console.log(`${h.hospital}: ${h.priced} price(s) filled in, ${h.added} item(s) added, ${h.kept} already priced by the hospital (left alone)`);
await mongoose.disconnect();
