// Sets up an empty database:
//  1. the first platform super admin – the main one – from config.seed.superAdmin (config/local.json);
//     must change the password at first login;
//  2. the starting master data lists, from config.seed.masterData.
// Safe to run again: anything that already exists is left as it is.
import { config } from '../src/config/index.js';
import { connectDatabase, disconnectDatabase } from '../src/db/connect.js';
import { hashPassword, passwordSchema } from '../src/core/password.js';
import { email as emailSchema } from '../src/core/validate.js';
import { MasterData } from '../src/modules/masterData/masterData.model.js';
import { User } from '../src/modules/users/user.model.js';

async function seedSuperAdmin() {
  const { name, email, password } = config.seed.superAdmin;
  // An existing account is left alone (its password may long since have been changed).
  const existing = email && (await User.findOne({ email: email.toLowerCase() }));
  if (existing) {
    console.log(`Super admin ${existing.email} already exists. Nothing changed.`);
    return;
  }

  const checks = [emailSchema.safeParse(email), passwordSchema.safeParse(password)];
  const problems = checks.filter((c) => !c.success).flatMap((c) => c.error.issues.map((i) => i.message));
  if (problems.length) {
    console.error(`Set seed.superAdmin.email and seed.superAdmin.password in config/local.json:\n  - ${problems.join('\n  - ')}`);
    process.exitCode = 1;
    return;
  }
  // The first super admin is the main one (only they manage super admin accounts).
  const isPrimary = !(await User.exists({ isPrimary: true }));
  await User.create({ name, email, passwordHash: await hashPassword(password), isSuperAdmin: true, isPrimary, mustChangePassword: true });
  console.log(`Super admin created for ${email}. A new password is asked for at first login.`);
}

async function seedMasterData() {
  for (const [type, items] of Object.entries(config.seed.masterData)) {
    let added = 0;
    for (const [index, item] of items.entries()) {
      const result = await MasterData.updateOne(
        { type, code: item.code.toUpperCase() },
        { $setOnInsert: { type, code: item.code.toUpperCase(), name: item.name, sortOrder: index + 1 } },
        { upsert: true, runValidators: true },
      );
      added += result.upsertedCount;
    }
    console.log(`Master data "${type}": ${added} added, ${items.length - added} already there.`);
  }
}

await connectDatabase();
try {
  await MasterData.init(); // the unique index exists before the upserts
  await seedSuperAdmin();
  await seedMasterData();
} finally {
  await disconnectDatabase();
}
