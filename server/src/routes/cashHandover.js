import { Router } from 'express';
import { z } from 'zod';
import { MAX_PAISE, MODE_LABELS, PAYMENT_MODES } from '../billing/billingRules.js';
import { addDays, hospitalDayStart, hospitalToday, isoDay } from '../careplans/dates.js';
import { Bill } from '../models/Bill.js';
import { CashHandover } from '../models/CashHandover.js';
import { hasRole } from '../models/Membership.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { objectId, parse, requiredDateOnly } from '../utils/validate.js';

// The daily cash handover (/api/cash-handover – owner, 17 Oct 2026, docs/WHATSAPP_DESK_PLAN.md):
//  - whoever took payments that day (reception, the billing department, the hospital admin) sees what Perinexa counted
//    from their own payments – cash in minus cash refunded, and the other modes – and hands over the cash they have,
//    with a note when it differs;
//  - a doctor or the hospital admin (never the same person) sees every handover of the day and confirms the cash they
//    received; a difference is shown, never hidden.
// Amounts only, no patient. The audit log gets the day, ids and amounts.

export const cashHandoverRouter = Router();

const TAKERS = ['receptionist', 'billing', 'admin', 'lab']; // the lab takes payments at walk-in registration
const CONFIRMERS = ['doctor', 'admin'];
const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');
const paise = z.number('Enter the amount').int().min(0).max(MAX_PAISE);
const note = z.string().trim().max(300).default('');

cashHandoverRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...TAKERS, ...CONFIRMERS)) throw forbidden('The cash handover is for reception, the billing department, doctors and the hospital admin.');
  next();
});

/** What one person collected on a day, from the bills' payments: { cashPaise, byMode, payments }. */
async function collected(tenantId, userId, day) {
  const [from, to] = [hospitalDayStart(day), hospitalDayStart(addDays(day, 1))];
  const bills = await Bill.find({ tenantId, payments: { $elemMatch: { by: userId, at: { $gte: from, $lt: to } } } }, { payments: 1 }).lean();
  const byMode = Object.fromEntries(PAYMENT_MODES.map((m) => [m, 0]));
  let payments = 0;
  for (const b of bills) {
    for (const p of b.payments ?? []) {
      if (String(p.by) !== String(userId) || !(p.at >= from && p.at < to)) continue;
      byMode[p.mode] += p.kind === 'refund' ? -p.amountPaise : p.amountPaise;
      payments += 1;
    }
  }
  return { cashPaise: byMode.cash ?? 0, byMode, payments };
}

const stampView = (s) => (s ? { byName: s.byName, at: s.at } : null);
const view = (h) => ({
  id: String(h._id),
  date: isoDay(h.day),
  userId: String(h.userId),
  userName: h.userName,
  cashPaise: h.cashPaise,
  byMode: h.byMode ?? {},
  payments: h.payments ?? 0,
  handedPaise: h.handedPaise,
  differencePaise: h.handedPaise - h.cashPaise,
  note: h.note ?? '',
  handed: stampView(h.handed),
  received: h.received ? { ...stampView(h.received), receivedPaise: h.received.receivedPaise, note: h.received.note ?? '', differencePaise: h.received.receivedPaise - h.handedPaise } : null,
});

const dayQuery = z.object({ date: requiredDateOnly('Date').optional() }).strict();

cashHandoverRouter.get('/', async (req, res) => {
  const { date } = parse(dayQuery, req.query);
  const today = hospitalToday(req.now);
  const day = date ?? today;
  const takes = hasRole(req.membership, ...TAKERS);
  const confirms = hasRole(req.membership, ...CONFIRMERS);
  const mine = takes ? await collected(req.tenantId, req.user._id, day) : null;
  const own = takes ? await CashHandover.findOne({ tenantId: req.tenantId, day, userId: req.user._id }).lean() : null;
  const all = confirms ? await CashHandover.find({ tenantId: req.tenantId, day }).sort({ userName: 1 }).lean() : [];
  res.json({
    date: isoDay(day),
    today: isoDay(today),
    modes: PAYMENT_MODES.map((m) => ({ mode: m, label: MODE_LABELS[m] })),
    mine: takes ? { ...mine, handover: own ? view(own) : null } : null,
    handovers: all.map(view),
    canHandOver: takes && day <= today,
    canConfirm: confirms,
  });
});

// Hand over (again, until it is confirmed): what Perinexa counted now, and the cash handed over.
cashHandoverRouter.post('/', async (req, res) => {
  if (!hasRole(req.membership, ...TAKERS)) throw forbidden('Only the people who take payments hand over cash.');
  const body = parse(z.object({ date: requiredDateOnly('Date').optional(), handedPaise: paise, note }).strict(), req.body);
  const day = body.date ?? hospitalToday(req.now);
  if (day > hospitalToday(req.now)) throw new HttpError(400, 'Cash is handed over on the day or later, not before.', 'VALIDATION');
  const counted = await collected(req.tenantId, req.user._id, day);
  if (body.handedPaise !== counted.cashPaise && body.note.length < 3) {
    throw Object.assign(new HttpError(400, 'The cash is different from what Perinexa counted: write why.', 'VALIDATION'), { fields: { note: 'Write why the cash is different.' } });
  }
  const existing = await CashHandover.findOne({ tenantId: req.tenantId, day, userId: req.user._id });
  if (existing?.received) throw new HttpError(409, 'This handover was already confirmed. Ask the person who confirmed it.', 'CONFLICT');
  const fields = { ...counted, userName: req.user.name, handedPaise: body.handedPaise, note: body.note, handed: { by: req.user._id, byName: req.user.name, at: req.now } };
  const h = existing ? Object.assign(existing, fields) : new CashHandover({ tenantId: req.tenantId, day, userId: req.user._id, ...fields });
  await h.save();
  await audit(req, 'CASH_HANDED_OVER', { details: { handoverId: String(h._id), day: isoDay(day), cashPaise: h.cashPaise, handedPaise: h.handedPaise } });
  res.status(existing ? 200 : 201).json({ handover: view(h) });
});

// Confirmed by a doctor or the hospital admin – never by the person who handed it over.
cashHandoverRouter.post('/:id/confirm', async (req, res) => {
  if (!hasRole(req.membership, ...CONFIRMERS)) throw forbidden('A doctor or the hospital admin confirms the cash received.');
  const { id } = parse(z.object({ id: objectId }), req.params);
  const body = parse(z.object({ receivedPaise: paise, note }).strict(), req.body);
  const h = await CashHandover.findOne({ tenantId: req.tenantId, _id: id });
  if (!h) throw new HttpError(404, 'This handover was not found.', 'NOT_FOUND');
  if (String(h.userId) === String(req.user._id)) throw forbidden('Someone else confirms the cash you handed over.');
  if (h.received) throw new HttpError(409, 'This handover is already confirmed.', 'CONFLICT');
  if (body.receivedPaise !== h.handedPaise && body.note.length < 3) {
    throw Object.assign(new HttpError(400, 'The cash received is different from what was handed over: write why.', 'VALIDATION'), { fields: { note: 'Write why it is different.' } });
  }
  h.received = { by: req.user._id, byName: req.user.name, at: req.now, receivedPaise: body.receivedPaise, note: body.note };
  await h.save();
  await audit(req, 'CASH_HANDOVER_CONFIRMED', { details: { handoverId: String(h._id), day: isoDay(h.day), handedPaise: h.handedPaise, receivedPaise: body.receivedPaise } });
  res.json({ handover: view(h) });
});

/** How many handovers wait for a confirmation (for Today). */
export const handoversToConfirm = (tenantId) => CashHandover.countDocuments({ tenantId, received: null });
