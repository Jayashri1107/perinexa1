import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { config } from './config.js';
import { authRouter } from './routes/auth.js';
import { platformTenantsRouter } from './routes/platformTenants.js';
import { platformUsersRouter } from './routes/platformUsers.js';
import { platformStatsRouter } from './routes/platformStats.js';
import { membersRouter } from './routes/members.js';
import { auditLogsRouter } from './routes/auditLogs.js';
import { doctorsRouter, patientsRouter } from './routes/patients.js';
import { calendarRouter } from './routes/calendar.js';
import { dictationWordsRouter } from './routes/dictationWords.js';
import { textShortcutsRouter } from './routes/textShortcuts.js';
import { visitDraftsRouter } from './routes/visitDrafts.js';
import { myDayRouter } from './routes/myDay.js';
import { tenantSettingsRouter } from './routes/settings.js';
import { templatesRouter } from './routes/templates.js';
import { redFlagRulesRouter } from './routes/redFlagRules.js';
import { worklistRouter } from './routes/worklist.js';
import { todayRouter } from './routes/today.js';
import { arrivalsRouter } from './routes/arrivals.js';
import { appointmentsRouter } from './routes/appointments.js';
import { billingRouter } from './routes/billing.js';
import { pharmacyRouter } from './routes/pharmacy.js';
import { pharmacyStockRouter } from './routes/pharmacyStock.js';
import { tallyRouter } from './routes/tally.js';
import { abdmPublicRouter, abdmRouter } from './routes/abdm.js';
import { beforePushBody } from './routes/abdmFetch.js';
import { inpatientsRouter } from './routes/inpatients.js';
import { bedsRouter } from './routes/beds.js';
import { labRouter } from './routes/lab.js';
import { referralsRouter } from './routes/referrals.js';
import { referringDoctorsRouter } from './routes/referringDoctors.js';
import { reminderOutboxRouter } from './routes/reminderOutbox.js';
import { portalRouter } from './routes/portal.js';
import { portalRecordsRouter } from './routes/portalRecords.js';
import { portalAccountRouter, portalSignupRouter } from './routes/portalSignup.js';
import { patientAccountsRouter } from './routes/patientAccounts.js';
import { displayRouter } from './routes/display.js';
import { medicineSafetyRouter } from './routes/medicineSafety.js';
import { aiAskRouter } from './routes/aiAsk.js';
import { aiBriefRouter } from './routes/aiBrief.js';
import { consentFormsRouter } from './routes/consentForms.js';
import { prescriptionDesignRouter } from './routes/prescriptionDesign.js';
import { prescriptionSetsRouter } from './routes/prescriptionSets.js';
import { labPackagesRouter } from './routes/labPackages.js';
import { labSetupRouter } from './routes/labSetup.js';
import { cashHandoverRouter } from './routes/cashHandover.js';
import { admissionDeskRouter } from './routes/admissionDesk.js';
import { labQcRouter } from './routes/labQc.js';
import { labStockRouter } from './routes/labStock.js';
import { imagingRouter } from './routes/imaging.js';
import { verifyRouter } from './routes/verify.js';
import { notificationsRouter } from './routes/notifications.js';
import { analyticsRouter } from './routes/analytics.js';
import { platformAnalyticsRouter } from './routes/platformAnalytics.js';
import { requireAnalyticsAudience } from './analytics/roles.js';
import {
  COOKIE_NAME,
  requireAuth,
  requirePasswordChanged,
  platformHospitalGuard,
  requirePlatform,
  staffOr,
  requireTenant,
  requireTenantRole,
} from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

// apiRateLimitMax: requests a minute per browser (tests with a frozen clock raise it).
// abdmPublicRateLimitMax: calls a minute from one address to ABDM's public addresses (ABDM's gateway, other hospitals).
// analyticsCacheMs: how long a doctor's Analytics page is kept (analytics/sectionCache.js; 0 = not kept).
// platformAnalyticsCacheMs: the same for the super admin's Analytics pages (5 minutes unless set).
// The request limit's key: the signed-in person (from the session cookie) or, before signing in, the internet address.
function personKey(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    try {
      return `u:${jwt.verify(token, config.JWT_SECRET).sub}`;
    } catch {
      /* expired or not ours: by address */
    }
  }
  return ipKeyGenerator(req.ip ?? '');
}

// Writes slow requests to the server's log (method, path with ids replaced, status, milliseconds) – never a query,
// a body or a name.
function logSlowRequests(ms) {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const took = Number(process.hrtime.bigint() - start) / 1e6;
      if (took < ms) return;
      const route = req.originalUrl.split('?')[0].replace(/[0-9a-f]{24}/gi, ':id');
      console.warn(`Slow request: ${req.method} ${route} ${res.statusCode} ${Math.round(took)} ms`);
    });
    next();
  };
}

export function createApp({
  loginRateLimitMax = config.LOGIN_RATE_LIMIT_MAX,
  portalOtpRateLimitMax = config.PORTAL_OTP_RATE_LIMIT_MAX,
  apiRateLimitMax = config.API_RATE_LIMIT_MAX,
  abdmPublicRateLimitMax = 3000,
  analyticsCacheMs = config.ANALYTICS_CACHE_SECONDS * 1000,
  platformAnalyticsCacheMs = config.ANALYTICS_PLATFORM_CACHE_SECONDS * 1000,
} = {}) {
  const app = express();
  if (config.TRUST_PROXY) app.set('trust proxy', config.TRUST_PROXY); // behind a load balancer (docs/DEPLOY.md)
  app.locals.analyticsCacheMs = analyticsCacheMs;
  app.locals.platformAnalyticsCacheMs = platformAnalyticsCacheMs;

  app.use(helmet());
  if (config.SLOW_REQUEST_MS) app.use(logSlowRequests(config.SLOW_REQUEST_MS));
  app.use(cors({ origin: config.CLIENT_URL, credentials: true, allowedHeaders: ['Content-Type', 'X-Tenant-Id'] }));
  // A photo or PDF of a report read by AI (Smart features) is larger than any other request.
  app.use(/^\/api\/patients\/[^/]+\/ai\/read-report$/, express.json({ limit: '10mb' }));
  app.use('/api/ai/transcribe', express.json({ limit: '12mb' }));
  // A lab report file (PDF or photo, at most 5 MB; base64 makes it about a third larger).
  app.use(/^\/api\/lab\/orders\/[^/]+\/files$/, express.json({ limit: '8mb' }));
  app.use(/^\/api\/patients\/[^/]+\/consents\/[^/]+\/scans$/, express.json({ limit: '8mb' }));
  app.use(/^\/api\/patients\/[^/]+\/visits\/[^/]+\/whatsapp$/, express.json({ limit: '8mb' })); // the PDF to send
  // A referral's files: the referring doctor's note or reports, and the PDF of a consultant note or discharge card
  // released to the referral desk (at most 5 MB each, like the files above).
  app.use(/^\/api\/referrals\/[^/]+\/(attachments|releases)$/, express.json({ limit: '8mb' }));
  // The medicine safety list is saved whole: 300 entries with their names, advice and sources do not fit in 100 kb.
  // (Each field has its own limit, so the list's "at most 300 entries" is reached before this one.)
  app.use('/api/medicine-safety', express.json({ limit: '2mb' }));
  app.use('/api/auth/me/photo', express.json({ limit: '200kb' })); // My profile: a small staff photo
  app.use(/^\/api\/lab-setup\/signatories(\/[^/]+)?$/, express.json({ limit: '300kb' })); // a signature picture (lab reports)
  // From ABDM and other hospitals (ABDM M2 and M3): a limit of their own, checked before any body is read – ABDM's
  // messages and the pages of her records come in bursts from a few addresses, and must not meet a browser's limit.
  app.use('/api/abdm/public', rateLimit({ windowMs: 60 * 1000, limit: abdmPublicRateLimitMax, standardHeaders: 'draft-8', legacyHeaders: false }));
  // A page of her records sent by another hospital through ABDM (M3): encrypted FHIR documents, an attached file of at
  // most 10 MB each (base64 twice: inside the document, then the encrypted document). Anyone can post to this address,
  // so it is refused before the body is read in practice mode and for an unknown HIU ID (routes/abdmFetch.js).
  app.use(/^\/api\/abdm\/public\/api\/v3\/hiu\/data\/push\/[^/]+$/, beforePushBody, express.json({ limit: '30mb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  // One moment per request: everything in a request (e.g. "today" for care plans) uses the same time,
  // even if the request happens to run across midnight.
  app.use((req, _res, next) => {
    req.now = new Date();
    next();
  });
  // Tell browsers never to cache API responses (they may contain private data).
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  // Counted per signed-in person, so the many staff of one hospital (often one internet address) never share a limit.
  app.use(
    '/api',
    rateLimit({
      windowMs: 60 * 1000,
      limit: apiRateLimitMax,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: personKey,
      skip: (req) => req.originalUrl.startsWith('/api/abdm/public/'),
    }),
  );

  // For the hosting's health check and uptime monitors: 503 while the database is not reachable.
  app.get('/api/health', (_req, res) => {
    const ok = mongoose.connection.readyState === 1;
    res.status(ok ? 200 : 503).json({ ok });
  });
  app.use('/api/auth', authRouter({ loginRateLimitMax }));
  // From ABDM (Scan & Share): no staff login – ABDM's signature is checked (routes/abdm.js)
  app.use('/api/abdm/public', abdmPublicRouter);
  // The patient portal (Version 2): its own sign-in with a code, no staff login (routes/portal.js)
  // Patients' own accounts: sign-up and sign-in on the hospital's portal, her password, and her records
  // (docs/PATIENT_ACCOUNTS_PLAN.md)
  app.use('/api/portal/h', portalSignupRouter({ otpLimitMax: portalOtpRateLimitMax }));
  app.use('/api/portal/account', portalAccountRouter);
  app.use('/api/portal/records', portalRecordsRouter);
  app.use('/api/portal', portalRouter);
  // The waiting-room screen: no login, a secret in the address, tokens and times only (routes/display.js)
  app.use('/api/display', displayRouter);

  const loggedIn = [requireAuth, requirePasswordChanged];

  // A person's own settings that don't belong to a hospital.
  app.use('/api/me/dictation-words', ...loggedIn, dictationWordsRouter);
  // Typing shortcuts (doctor ideas #3): the person's own
  app.use('/api/me/shortcuts', ...loggedIn, textShortcutsRouter);

  // Platform: hospitals, all user accounts, full audit log. Super admins read and change everything; platform admins
  // read everything and change only the areas a super admin gave them (requirePlatform).
  const platform = (area) => [...loggedIn, requirePlatform(area)];
  app.use('/api/platform/stats', ...platform(null), platformStatsRouter);
  app.use('/api/platform/tenants', ...platform(staffOr('hospitals')), platformTenantsRouter);
  app.use('/api/platform/users', ...platform('users'), platformUsersRouter);
  app.use('/api/platform/audit-logs', ...platform(null), auditLogsRouter({ scope: 'platform' }));
  // Analytics totals per hospital and for all hospitals: numbers only, never a patient (analytics/platformTotals.js).
  app.use('/api/platform/analytics', ...platform(null), platformAnalyticsRouter);

  // Hospital data: always limited to the hospital selected in the session.
  // A super admin or platform admin in a hospital reaches its setup only (platformHospitalGuard).
  const inTenant = [...loggedIn, requireTenant, platformHospitalGuard];
  const tenantAdmin = [...inTenant, requireTenantRole('admin')];
  app.use('/api/tenant/members', ...tenantAdmin, membersRouter({ resolveTenantId: (req) => req.tenantId, allowAccountChanges: true }));
  app.use('/api/tenant/audit-logs', ...tenantAdmin, auditLogsRouter({ scope: 'tenant' }));
  app.use('/api/tenant/settings', ...inTenant, tenantSettingsRouter);
  app.use('/api/tenant/doctors', ...inTenant, doctorsRouter);
  app.use('/api/care-plans/templates', ...inTenant, templatesRouter);
  app.use('/api/consent-forms', ...inTenant, consentFormsRouter);
  app.use('/api/prescription-design', ...inTenant, prescriptionDesignRouter);
  app.use('/api/prescription-sets', ...inTenant, prescriptionSetsRouter);
  app.use('/api/lab-packages', ...inTenant, labPackagesRouter);
  app.use('/api/red-flag-rules', ...inTenant, redFlagRulesRouter);
  app.use('/api/worklist', ...inTenant, worklistRouter);
  app.use('/api/today', ...inTenant, todayRouter);
  app.use('/api/arrivals', ...inTenant, arrivalsRouter);
  app.use('/api/appointments', ...inTenant, appointmentsRouter);
  app.use('/api/billing', ...inTenant, billingRouter);
  // The daily cash handover (routes/cashHandover.js)
  app.use('/api/cash-handover', ...inTenant, cashHandoverRouter);
  app.use('/api/pharmacy', ...inTenant, pharmacyRouter);
  // Stock while prescribing (doctors and RMOs): in stock / low / out only (routes/pharmacyStock.js)
  app.use('/api/pharmacy-stock', ...inTenant, pharmacyStockRouter);
  app.use('/api/abdm', ...inTenant, abdmRouter);
  app.use('/api/inpatients', ...inTenant, inpatientsRouter);
  // Beds and admission at the desk (routes/beds.js)
  app.use('/api/beds', ...inTenant, bedsRouter);
  // Admission like a hospital system: requests, checklist, papers, clearance (routes/admissionDesk.js)
  app.use('/api/admission-desk', ...inTenant, admissionDeskRouter);
  app.use('/api/lab', ...inTenant, labRouter);
  // Referrals from other doctors and the referring doctors (docs/REFERRALS_PLAN.md – brought from the other Perinexa
  // copy, 19 Oct 2026): the referral desk, doctors and RMOs only (routes/referrals.js REFERRAL_ROLES)
  app.use('/api/referrals', ...inTenant, referralsRouter);
  app.use('/api/referring-doctors', ...inTenant, referringDoctorsRouter);
  // The Tally link (docs/TALLY_PLAN.md – from the other Perinexa copy, 19 Oct 2026): the accountant's files, for the
  // hospital admin only (routes/tally.js)
  app.use('/api/tally', ...inTenant, tallyRouter);
  // The lab's test list and settings (routes/labSetup.js)
  app.use('/api/lab-setup', ...inTenant, labSetupRouter);
  // Lab version 2 (docs/LAB_V2_PLAN.md): quality control, the lab's stock and cost per test, USG and radiology
  app.use('/api/lab-qc', ...inTenant, labQcRouter);
  app.use('/api/lab-stock', ...inTenant, labStockRouter);
  app.use('/api/imaging', ...inTenant, imagingRouter);
  // The bell: this person's notifications (routes/notifications.js)
  app.use('/api/notifications', ...inTenant, notificationsRouter);
  // Is this lab report genuine? (the QR code on a printed report – no login)
  app.use('/api/verify', verifyRouter);
  app.use('/api/reminders', ...inTenant, reminderOutboxRouter);
  // Reception: patients' sign-ups to approve or reject (routes/patientAccounts.js)
  app.use('/api/patient-accounts', ...inTenant, patientAccountsRouter);
  // Nothing gets lost: the person's own unsaved visits (doctor ideas #4)
  app.use('/api/visit-drafts', ...inTenant, visitDraftsRouter);
  // Your day so far (doctor ideas #9)
  app.use('/api/my-day', ...inTenant, myDayRouter);
  app.use('/api/medicine-safety', ...inTenant, medicineSafetyRouter);
  app.use('/api/ai/brief', ...inTenant, aiBriefRouter); // before /api/ai (Ask your records)
  app.use('/api/ai', ...inTenant, aiAskRouter);
  app.use('/api/patients', ...inTenant, patientsRouter);
  // The calendar (its own path: under /api/patients it would collide with GET /api/patients/:id).
  app.use('/api/calendar', ...inTenant, calendarRouter);
  // Analytics: numbers for doctors and hospital admins only (analytics/roles.js).
  app.use('/api/analytics', ...inTenant, requireAnalyticsAudience, analyticsRouter);

  app.use('/api', notFound);

  // In production the server also delivers the built website.
  const clientDist = fileURLToPath(new URL('../../client/dist', import.meta.url));
  if (config.isProduction && existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('/{*splat}', (_req, res) => res.sendFile('index.html', { root: clientDist }));
  }

  app.use(errorHandler);
  return app;
}
