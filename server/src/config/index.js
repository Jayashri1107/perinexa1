// The one place the server reads its settings from. Everything comes from config/*.json, checked here,
// so a missing or wrong value stops the server at start-up with a clear message.
import { z } from 'zod';
import { loadConfig } from '../../../config/loadConfig.js';

const keyLabel = z.object({ key: z.string().min(1), label: z.string().min(1) });

const schema = z.object({
  app: z.object({ name: z.string().min(1), tagline: z.string() }),
  server: z.object({
    host: z.string().min(1),
    port: z.number().int().positive(),
    apiPrefix: z.string().startsWith('/'),
    jsonLimit: z.string().min(1),
    trustProxy: z.union([z.boolean(), z.number(), z.string()]),
  }),
  client: z.object({ port: z.number().int().positive(), url: z.url() }),
  database: z.object({
    uri: z.string().startsWith('mongodb'),
    autoIndex: z.boolean(),
    slowQueryMs: z.number().nonnegative(),
    logAllQueries: z.boolean(),
  }),
  auth: z.object({
    jwtSecret: z.string().min(32, 'auth.jwtSecret must be at least 32 characters – set it in config/local.json'),
    cookieName: z.string().min(1),
    cookieSecure: z.boolean(),
    sessionTimeoutMinutes: z.number().int().positive(),
    bcryptRounds: z.number().int().min(4).max(15),
    password: z.object({ minLength: z.number().int().min(8), maxLength: z.number().int().max(256) }),
    temporaryPassword: z.object({
      groups: z.number().int().positive(),
      groupLength: z.number().int().positive(),
      alphabet: z.string().min(20),
    }),
  }),
  rateLimit: z.object({
    login: z.object({ windowMinutes: z.number().positive(), max: z.number().int().positive() }),
    api: z.object({ windowMinutes: z.number().positive(), max: z.number().int().positive() }),
  }),
  pagination: z.object({
    defaultLimit: z.number().int().positive(),
    limitOptions: z.array(z.number().int().positive()).min(1),
    maxLimit: z.number().int().positive(),
  }),
  roles: z.array(keyLabel).min(1),
  adminRole: z.string().min(1),
  masterData: z.object({
    types: z.array(keyLabel.extend({ singular: z.string().min(1) })).min(1),
    // which master-data list holds the departments a hospital can have
    hospitalDepartmentType: z.string().min(1),
  }),
  dashboard: z.object({ recentActivityCount: z.number().int().positive(), topHospitalsCount: z.number().int().positive() }),
  seed: z.object({
    superAdmin: z.object({ name: z.string(), email: z.string(), password: z.string() }),
    masterData: z.record(z.string(), z.array(z.object({ code: z.string(), name: z.string() }))),
  }),
});

function readConfig() {
  const result = schema.safeParse(loadConfig());
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    console.error(`Invalid settings in config/*.json:\n${lines.join('\n')}`);
    process.exit(1);
  }
  const cfg = result.data;
  if (!cfg.roles.some((r) => r.key === cfg.adminRole)) {
    console.error(`adminRole "${cfg.adminRole}" is not one of the roles in config.`);
    process.exit(1);
  }
  if (!cfg.masterData.types.some((t) => t.key === cfg.masterData.hospitalDepartmentType)) {
    console.error(`masterData.hospitalDepartmentType "${cfg.masterData.hospitalDepartmentType}" is not one of the master data types.`);
    process.exit(1);
  }
  return Object.freeze(cfg);
}

export const config = readConfig();

// Lookups derived from the settings, so the rest of the code never repeats the lists.
export const ROLE_KEYS = config.roles.map((r) => r.key);
export const MASTER_TYPE_KEYS = config.masterData.types.map((t) => t.key);
