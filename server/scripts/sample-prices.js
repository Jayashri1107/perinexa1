// Gives every hospital the starting price list at SAMPLE prices (config.billing.startingPriceList): adds missing
// starting items and prices those still at ₹0. Prices someone has set are never changed. Fake data only.
//   npm run prices:sample
import { connectDatabase, disconnectDatabase } from '../src/db/connect.js';
import { Hospital } from '../src/modules/hospitals/hospital.model.js';
import { fillSamplePrices } from '../src/modules/priceList/priceList.service.js';

await connectDatabase();
for (const h of await Hospital.find({}).select('name').lean()) {
  const { added, priced } = await fillSamplePrices(h._id);
  console.log(`${h.name}: ${added} items added, ${priced} sample prices set`);
}
await disconnectDatabase();
