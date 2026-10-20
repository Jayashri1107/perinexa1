import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import { config } from './config.js';
import { createApp } from './app.js';
import { expireAllDue } from './abdm/fetchRecords.js';
import { ensureStandardTemplates } from './careplans/templatesService.js';
import { convertNextVisits } from './appointments/appointmentService.js';
import { Appointment } from './models/Appointment.js';
import { CarePlanTemplate } from './models/CarePlanTemplate.js';
import { ReminderMessage } from './models/ReminderMessage.js';
import { Tenant } from './models/Tenant.js';
import { runReminders } from './reminders/reminderService.js';

// A hosted database with its own CA certificate (docs/DEPLOY.md): the certificate is written to a private temporary
// file, which the database driver reads.
function databaseOptions() {
  if (!config.MONGO_CA_CERT.trim()) return {};
  const file = path.join(os.tmpdir(), 'perinexa-mongo-ca.pem');
  // (a certificate pasted on one line keeps its line breaks as "\n")
  writeFileSync(file, config.MONGO_CA_CERT.replace(/\\n/g, '\n'), { mode: 0o600 });
  return { tls: true, tlsCAFile: file };
}

try {
  await mongoose.connect(config.MONGO_URI, { serverSelectionTimeoutMS: 5000, ...databaseOptions() });
} catch (err) {
  console.error('\n❌ Could not connect to the database. Is MongoDB running? Try: npm run db:start\n');
  console.error(err.message);
  process.exit(1);
}

// Make sure the "one hospital standard template per care type" rule exists in the database, and bring every
// hospital's built-in draft risk rules up to date now – rather than in the middle of someone's first save.
try {
  await CarePlanTemplate.init();
  const tenants = await Tenant.find({}, { _id: 1 }).lean();
  for (const t of tenants) await ensureStandardTemplates(t._id);
} catch (err) {
  console.error('\n⚠️  WARNING: could not prepare the care-plan templates / risk rules at startup.');
  console.error('   Risk levels may be out of date until this is fixed. Details:', err.message, '\n');
}

// Appointment booking: the outbox's one-message-per-change rule (its index changed), and the next-visit dates
// booked before appointment booking turned into appointments – once; running again finds nothing to do.
try {
  await Promise.all([ReminderMessage.syncIndexes(), Appointment.init()]);
  const tenants = await Tenant.find({}, { _id: 1 }).lean();
  let made = 0;
  for (const t of tenants) made += await convertNextVisits(t._id);
  if (made) console.log(`Appointments: ${made} next-visit date(s) turned into appointments.`);
} catch (err) {
  console.error('\n⚠️  WARNING: could not prepare appointment booking at startup. Details:', err.message, '\n');
}

const server = createApp().listen(config.API_PORT, () => {
  console.log(`✅ Server running on http://localhost:${config.API_PORT} (${config.NODE_ENV})`);
});
// Behind the hosting's load balancer: keep idle connections a little longer than it does.
server.keepAliveTimeout = 65 * 1000;
server.headersTimeout = 66 * 1000;

// Stopping (a new version pushed, the hosting restarting the server): finish the requests in progress, then close the
// database, instead of cutting people off in the middle of a save.
let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: finishing requests in progress, then stopping.`);
  server.close(async () => {
    await mongoose.disconnect().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 15 * 1000).unref(); // never wait more than 15 seconds
}
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
// A mistake in one request must not stop the server for everyone: write it to the log and carry on.
process.on('unhandledRejection', (err) => console.error('Unhandled error (the server keeps running):', err?.stack ?? err));

// Automatic reminders (Version 2): once an hour, for hospitals that switched them on (Hospital admin → Patient
// messages). Without a message provider in server/.env they wait in the outbox for staff to send by hand.
const REMINDER_ROUND_MS = 60 * 60 * 1000;
const reminderRound = () => runReminders(new Date()).catch((err) => console.error('Reminders round failed:', err?.message ?? err));
setTimeout(reminderRound, 60 * 1000).unref();
setInterval(reminderRound, REMINDER_ROUND_MS).unref();

// ABDM (M3): records fetched from other hospitals are deleted when her consent ends – when the server starts, and every
// 15 minutes (her records are also checked whenever they are opened).
const ABDM_EXPIRY_ROUND_MS = 15 * 60 * 1000;
const abdmExpiryRound = () => expireAllDue(new Date()).catch((err) => console.error('ABDM: deleting ended records failed:', err?.message ?? err));
abdmExpiryRound();
setInterval(abdmExpiryRound, ABDM_EXPIRY_ROUND_MS).unref();
