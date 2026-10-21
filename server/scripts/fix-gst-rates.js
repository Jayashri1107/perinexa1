// Moves medicines still on the old 12 % GST rate to 5 % (all hospitals) and lists them, so the pharmacist can check
// each one – a non-medicine item (sanitiser, cosmetics) may need 18 % instead. From the project folder:
//   npm run fix:gst-rates
// Everything it does is in src/pharmacy/gstRateFix.js.
import mongoose from 'mongoose';
import { config } from '../src/config.js';
import { fixOldGstRates } from '../src/pharmacy/gstRateFix.js';

await mongoose.connect(config.MONGO_URI);
const moved = await fixOldGstRates();
if (!moved.length) console.log('No medicine is on an old GST rate. Nothing changed.');
for (const h of moved) console.log(`${h.hospital}: ${h.medicines.length} medicine(s) moved to 5 % GST – ${h.medicines.join(', ')}`);
await mongoose.disconnect();
