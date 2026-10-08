// The one place the server reads its settings from. Everything comes from config/*.json, checked here,
// so a missing or wrong value stops the server at start-up with a clear message.
import { z } from 'zod';
import { loadConfig } from '../../../config/loadConfig.js';

// { key, label } plus any extra flags of that list (needsLmp, needsReference, register …), which are kept.
const keyLabel = z.looseObject({ key: z.string().min(1), label: z.string().min(1) });
const roleList = z.array(z.string().min(1));
const prefix = z.string().min(1).max(6);
const digits = z.number().int().min(3).max(10);

const schema = z.object({
  app: z.object({
    name: z.string().min(1),
    tagline: z.string(),
    // the hospitals' clock: days and months in reports follow it
    timezone: z.string().min(1),
    utcOffset: z.string().regex(/^[+-]\d{2}:\d{2}$/),
  }),
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
    maxPoolSize: z.number().int().min(5).max(500), // database connections kept open for requests served at the same time
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
    password: z.object({
      minLength: z.number().int().min(8),
      maxLength: z.number().int().max(256),
      requireUppercase: z.boolean(),
      requireLowercase: z.boolean(),
      requireNumber: z.boolean(),
      requireSpecial: z.boolean(),
    }),
    temporaryPassword: z.object({
      groups: z.number().int().positive(),
      groupLength: z.number().int().positive(),
      alphabet: z.string().min(20),
    }),
  }),
  rateLimit: z.object({
    // max: per account and address; perAddressMax: all accounts from one address
    login: z.object({ windowMinutes: z.number().positive(), max: z.number().int().positive(), perAddressMax: z.number().int().positive() }),
    api: z.object({ windowMinutes: z.number().positive(), max: z.number().int().positive() }),
  }),
  pagination: z.object({
    defaultLimit: z.number().int().positive(),
    limitOptions: z.array(z.number().int().positive()).min(1),
    maxLimit: z.number().int().positive(),
  }),
  roles: z.array(keyLabel).min(1),
  adminRole: z.string().min(1),
  // which roles may use which part of a hospital's work
  access: z.object({
    patients: roleList,
    registerPatients: roleList,
    registrationMenu: roleList,
    admitPatients: roleList,
    wards: roleList,
    patientDocuments: roleList,
    dischargeCards: roleList,
    patientsAllRecords: roleList,
    patientsClinical: roleList,
    patientsContact: roleList,
    billing: roleList,
    billingReports: roleList,
    priceListEdit: roleList,
    billingAdmin: roleList,
    pharmacy: roleList,
    pharmacyCounter: roleList,
    dispense: roleList, // give a prescription: its medicines, other charges, payment and the bill
    pharmacyAdmin: roleList,
    analytics: roleList,
    analyticsExact: roleList,
    appointments: roleList,
    bookAppointments: roleList,
    calendar: roleList,
    calendarClinical: roleList,
    lab: roleList,
    labOrder: roleList,
    labReport: roleList,
    labReview: roleList,
    library: roleList,
    libraryEdit: roleList,
    libraryApprove: roleList,
    superAdminInHospitals: z.boolean(),
    superAdminPatientAccess: z.boolean(),
  }),
  patients: z.object({
    numberPrefix: prefix,
    numberDigits: digits,
    eddDays: z.number().int().positive(),
    emergencyAccessHours: z.number().positive(),
    careTypes: z.array(keyLabel).min(1),
    sexes: z.array(keyLabel).min(1),
    bloodGroups: z.array(z.string().min(1)),
    idProofTypes: z.array(keyLabel).min(1),
    ageBands: z.array(z.number().int().nonnegative()).min(2),
    pincodeLookupUrl: z.string().url(),
  }),
  wards: z.object({
    kinds: z.array(keyLabel).min(1),
    starting: z.array(z.object({ name: z.string().min(2).max(60), kind: z.string().min(1), beds: z.number().int().min(1).max(200), bedPrefix: z.string().max(6) })),
  }),
  notifications: z.object({ listSize: z.number().int().min(5).max(200), keepDays: z.number().int().min(1).max(365) }),
  documents: z.object({
    maxMegabytes: z.number().positive().max(15),
    recentDischargeDays: z.number().int().positive(),
    kinds: z.array(keyLabel).min(1),
  }),
  billing: z.object({
    billPrefix: prefix,
    receiptPrefix: prefix,
    numberDigits: digits,
    currencySymbol: z.string().min(1),
    upiHistoryLimit: z.number().int().positive(),
    overdueDays: z.number().int().min(1).max(365), // a bill still owing after this many days is "overdue"
    paymentModes: z.array(keyLabel).min(1),
    priceGroups: z.array(keyLabel).min(1),
    pharmacyGroup: z.string().min(1),
    // The ready-made items a hospital's price list starts with, at SAMPLE prices for the hospital to check and change.
    startingPriceList: z.array(z.object({ code: z.string().regex(/^[A-Z0-9_-]{2,20}$/), name: z.string().min(1).max(120), group: z.string().min(1), price: z.number().min(0) })),
  }),
  pharmacy: z.object({
    invoicePrefix: prefix,
    orderPrefix: prefix,
    supplierReturnPrefix: prefix,
    numberDigits: digits,
    expiryAlertDays: z.number().int().positive(),
    gstRates: z.array(z.number().nonnegative()).min(1),
    forms: z.array(keyLabel).min(1),
    schedules: z.array(keyLabel).min(1),
    adjustReasons: z.array(keyLabel).min(1),
    supplierReturnReasons: z.array(keyLabel).min(1),
  }),
  analytics: z.object({
    months: z.number().int().min(1).max(36),
    smallNumberBelow: z.number().int().nonnegative(),
    dueSoonDays: z.number().int().positive(),
  }),
  masterData: z.object({
    types: z.array(keyLabel.extend({ singular: z.string().min(1) })).min(1),
    // which master-data list holds the departments a hospital can have
    hospitalDepartmentType: z.string().min(1),
  }),
  dashboard: z.object({ recentActivityCount: z.number().int().positive(), topHospitalsCount: z.number().int().positive() }),
  prescriberRoles: z.array(z.string().min(1)),
  languages: z.array(keyLabel).min(1),
  opd: z.object({
    doctorRole: z.string().min(1),
    slotMinutes: z.number().int().min(5).max(60),
    // The hospital's usual OPD hours (0 = Sunday): used for a doctor who has not set her own OPD timings yet.
    defaultSessions: z.object({
      days: z.array(z.number().int().min(0).max(6)),
      sessions: z.array(z.object({ from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) })).min(1),
    }),
    maxSessionsPerDay: z.number().int().min(1).max(10),
    maxLeavePeriods: z.number().int().min(1),
    visitTypes: z.array(keyLabel.extend({ defaultMinutes: z.number().int().positive() })).min(1),
  }),
  appointments: z.object({
    maxDaysAhead: z.number().int().min(1).max(3660),
    // reminders: the day this many days ahead is the Reminders tab's first choice
    reminderDaysAhead: z.number().int().min(0).max(30),
    cancelReasons: z.array(keyLabel).min(1),
  }),
  calendar: z.object({
    weekStartsOn: z.number().int().min(0).max(6), // 0 = Sunday, 1 = Monday
    maxRangeDays: z.number().int().min(7).max(62),
  }),
  admissions: z.object({ admissionPrefix: prefix, numberDigits: digits }),
  lab: z.object({ orderPrefix: prefix, numberDigits: digits, maxTestsPerOrder: z.number().int().min(1).max(100) }),
  library: z.object({ maxEntries: z.number().int().min(10).max(2000) }),
  appearance: z.object({ textSize: z.array(keyLabel).min(1), density: z.array(keyLabel).min(1) }),
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
  const accessRoles = Object.values(cfg.access).filter(Array.isArray).flat();
  const unknownRoles = [...cfg.prescriberRoles, cfg.opd.doctorRole, ...accessRoles].filter((r) => !cfg.roles.some((x) => x.key === r));
  if (unknownRoles.length) {
    console.error(`Unknown roles in prescriberRoles / opd.doctorRole: ${unknownRoles.join(', ')}`);
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
export const LANGUAGE_KEYS = config.languages.map((l) => l.key);
export const VISIT_TYPE_KEYS = config.opd.visitTypes.map((v) => v.key);
export const TEXT_SIZE_KEYS = config.appearance.textSize.map((o) => o.key);
export const DENSITY_KEYS = config.appearance.density.map((o) => o.key);
export const keysOf = (list) => list.map((o) => o.key);
export const CARE_TYPE_KEYS = keysOf(config.patients.careTypes);
export const SEX_KEYS = keysOf(config.patients.sexes);
export const PAYMENT_MODE_KEYS = keysOf(config.billing.paymentModes);
export const PRICE_GROUP_KEYS = keysOf(config.billing.priceGroups);
export const MEDICINE_FORM_KEYS = keysOf(config.pharmacy.forms);
export const SCHEDULE_KEYS = keysOf(config.pharmacy.schedules);
export const REGISTER_SCHEDULE_KEYS = config.pharmacy.schedules.filter((s) => s.register).map((s) => s.key);
export const ADJUST_REASON_KEYS = keysOf(config.pharmacy.adjustReasons);
export const SUPPLIER_RETURN_REASON_KEYS = keysOf(config.pharmacy.supplierReturnReasons);
// Schedule X and narcotic medicines: a witness signs when they leave the pharmacy other than by sale.
export const WITNESS_SCHEDULE_KEYS = config.pharmacy.schedules.filter((s) => s.witness).map((s) => s.key);
export const CANCEL_REASON_KEYS = keysOf(config.appointments.cancelReasons);
