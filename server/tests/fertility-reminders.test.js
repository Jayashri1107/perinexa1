// Cycle reminders (fertility idea F5, the owner's go-ahead of 27 Oct 2026): a cycle's pregnancy-test day counts as "a
// check-up or test is due" – the general message with the same fixed words as every other (nothing about the
// treatment), under the same switches; no longer due once a result is written. Fake data only.
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testDueOn } from '../src/fertility/cycleReminders.js';
import { FertilityCycle } from '../src/models/FertilityCycle.js';
import { Patient } from '../src/models/Patient.js';
import { ReminderMessage } from '../src/models/ReminderMessage.js';
import { Tenant } from '../src/models/Tenant.js';
import { cancelStaleGeneral, queueCareDue } from '../src/reminders/generalReminders.js';
import { careDueMessage } from '../src/reminders/messages.js';
import { connectTestDb, createTenant, disconnectTestDb, resetTestDb } from './helpers.js';

const D = (s) => new Date(`${s}T00:00:00Z`);
const noon = (s) => new Date(`${s}T06:00:00Z`);
let tenant;
let patient;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await resetTestDb();
  const t = await createTenant('Cycle Reminder Hospital');
  await Tenant.updateOne({ _id: t._id }, { $set: { 'letterhead.name': 'Sample Hospital', 'letterhead.phone': '020 0000 0000', 'messaging.remindersEnabled': true } });
  tenant = await Tenant.findById(t._id).lean();
  patient = await Patient.create({
    tenantId: tenant._id,
    mrn: 'P-900001',
    careType: 'infertility',
    fullName: 'Cycle Sample',
    ageYears: 30,
    phone: '+91 98765 43210',
    reminders: { consent: true, channel: 'sms', language: 'en' },
    createdBy: new mongoose.Types.ObjectId(),
  });
});

const cycle = (extra) =>
  FertilityCycle.create({
    tenantId: tenant._id,
    patientId: patient._id,
    planId: new mongoose.Types.ObjectId(),
    number: 1,
    day1: D('2026-10-01'),
    status: 'after_trigger',
    created: { byName: 'Sample Doctor', at: D('2026-10-01') },
    clientRequestId: randomUUID(),
    ...extra,
  });

describe('the pregnancy-test day of a cycle', () => {
  it('is 14 days after the relations or IUI day, or else the trigger', () => {
    expect(testDueOn({ trigger: { at: noon('2026-10-12') } })).toEqual(D('2026-10-26'));
    expect(testDueOn({ trigger: { at: noon('2026-10-12') }, timing: { on: D('2026-10-13') } })).toEqual(D('2026-10-27'));
    expect(testDueOn({ trigger: { at: null }, timing: { on: null } })).toBeNull();
  });

  it('queues the general "something is due" message on that day – not before – and cancels it once a result is written', async () => {
    const c = await cycle({ trigger: { at: noon('2026-10-12') } });
    expect(await queueCareDue(tenant, noon('2026-10-25'))).toEqual({ added: 0, heldBack: 0 });
    expect((await queueCareDue(tenant, noon('2026-10-26'))).added).toBe(1);
    const [m] = await ReminderMessage.find({ tenantId: tenant._id }).lean();
    expect(m).toMatchObject({ kind: 'care_due', to: '+919876543210', text: careDueMessage({ hospital: 'Sample Hospital', phone: '020 0000 0000', lang: 'en' }) });
    expect(m.text).not.toMatch(/fertil|cycle|pregnan|inject|IUI/i);

    await FertilityCycle.updateOne({ _id: c._id, tenantId: tenant._id }, { $set: { 'outcome.test': 'negative', status: 'completed' } });
    expect(await cancelStaleGeneral(tenant, noon('2026-10-27'))).toBe(1);
    expect((await ReminderMessage.findOne({ _id: m._id, tenantId: tenant._id }).lean()).status).toBe('cancelled');
  });

  it('sends nothing for a cancelled cycle, nor without her agreement', async () => {
    await cycle({ trigger: { at: noon('2026-10-12') }, cancelled: { reason: 'no_response', byName: 'Sample Doctor', at: D('2026-10-10') } });
    expect((await queueCareDue(tenant, noon('2026-10-26'))).added).toBe(0);
    await FertilityCycle.deleteMany({ tenantId: tenant._id });
    await cycle({ trigger: { at: noon('2026-10-12') } });
    await Patient.updateOne({ _id: patient._id, tenantId: tenant._id }, { $set: { 'reminders.consent': false } });
    expect((await queueCareDue(tenant, noon('2026-10-26'))).added).toBe(0);
  });
});
