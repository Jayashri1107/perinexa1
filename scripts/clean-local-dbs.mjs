// Removes the leftover TEST and PREVIEW databases on THIS computer's MongoDB (127.0.0.1 only) – the copies made by
// test runs (…_test), screen previews (…_preview) and load tests (…_loadtest). Never the apps' own databases, never
// MongoDB's own (admin, config, local), never another project's.
//
//   node scripts/clean-local-dbs.mjs          shows what would be removed (nothing is deleted)
//   node scripts/clean-local-dbs.mjs --yes    removes them
//
// A test database is made again by itself the next time the tests run.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { default: mongoose } = await import('mongoose');
const LOCAL = 'mongodb://127.0.0.1:27017/admin';
const REMOVABLE = /(_test|_preview|_uipreview|_loadtest)$/;
const NEVER = new Set(['admin', 'config', 'local']);

// The database each app on this computer uses (its server/.env) is never removed, whatever its name.
for (const env of ['../server/.env', '../../Perinexa/server/.env']) {
  try {
    const line = readFileSync(fileURLToPath(new URL(env, import.meta.url)), 'utf8').split(/\r?\n/).find((l) => l.startsWith('MONGO_URI='));
    const name = line?.split('/').pop()?.split('?')[0]?.trim();
    if (name) NEVER.add(name);
  } catch {
    /* that app is not on this computer */
  }
}

const yes = process.argv.includes('--yes');
await mongoose.connect(LOCAL, { serverSelectionTimeoutMS: 5000 });
const { databases } = await mongoose.connection.db.admin().listDatabases();
const remove = databases.filter((d) => REMOVABLE.test(d.name) && !NEVER.has(d.name)).sort((a, b) => a.name.localeCompare(b.name));
const keep = databases.filter((d) => !remove.includes(d)).map((d) => d.name).sort();
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

console.log(`Kept (${keep.length}): ${keep.join(', ')}`);
console.log(`\n${yes ? 'Removing' : 'Would remove'} ${remove.length} test/preview databases (${mb(remove.reduce((s, d) => s + d.sizeOnDisk, 0))}):`);
for (const d of remove) console.log(`  ${d.name}  ${mb(d.sizeOnDisk)}`);
if (yes) {
  for (const d of remove) await mongoose.connection.client.db(d.name).dropDatabase();
  console.log(`\nDone: ${remove.length} removed.`);
} else {
  console.log('\nNothing was deleted. To remove them: node scripts/clean-local-dbs.mjs --yes');
}
await mongoose.disconnect();
