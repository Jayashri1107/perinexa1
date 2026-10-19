import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// A patient sent by another doctor (Referrals, docs/REFERRALS_PLAN.md – the owner's decisions of 15 Oct 2026), and
// the guide's promises to that doctor: the reply, seeing her on time, the consultant note, the discharge summary.
//   open → closed (done, with a reason) – or cancelled (logged by mistake, with a reason: no clocks).
// Before she is registered the referral holds what the doctor said of her (guest: name, phone, age); once she is
// linked to her record, patientId – exactly one of the two. When she was first seen (firstSeen) and discharged
// (discharge) are found by the app from her record (referrals/referralService.js), never typed.
// note: the consultant note in the guide's own layout (page 7), written and signed at the hospital; it reaches the
// referring doctor only as a PDF released to the desk, and only after her recorded Yes (sharing). Messages are sent
// by the desk from its own WhatsApp and marked sent here by hand – who sent what and when.
// Free text is checked for words about the baby's sex (routes/referrals.js); nothing from a visit's private note.
// Never deleted.

const { ObjectId } = mongoose.Schema.Types;
const byFields = { by: { type: ObjectId, ref: 'User' }, byName: String, at: Date };
const stampSchema = new mongoose.Schema(byFields, { _id: false });
const stamp = () => ({ type: stampSchema, default: null });
const text = (max) => ({ type: String, trim: true, maxlength: max, default: '' });

export const REFERRAL_STATUSES = ['open', 'closed', 'cancelled'];
export const REFERRAL_VIA = ['whatsapp', 'call', 'walk_in', 'letter'];
export const REFERRAL_URGENCY = ['urgent', 'routine'];
export const SHARING_ANSWERS = ['yes', 'no'];
export const RELEASE_KINDS = ['note', 'discharge'];
export const MESSAGE_KINDS = ['reply', 'note', 'discharge', 'other'];
export const REVIEW_PROMISES = ['reply', 'seen', 'note', 'discharge'];
export const MAX_ATTACHMENTS = 10;
// What the referring doctor sent with her (the guide, page 3: "What to send with her"), each a short text.
export const SENT_FIELDS = ['lmpEdd', 'gravidaPara', 'bp', 'hb', 'sugar', 'medicines', 'scans'];
// The consultant note's fields (the guide's layout, page 7), with their longest length.
export const NOTE_FIELDS = { questionRestated: 300, findings: 3000, diagnosis: 1000, plan: 3000, needFromYou: 1000, returnsToYouFor: 500, nextAtAnandi: 300 };

const reasonStamp = () => ({ type: new mongoose.Schema({ ...byFields, reason: { type: String, maxlength: 300 } }, { _id: false }), default: null });

const sharingSchema = new mongoose.Schema({ answer: { type: String, enum: SHARING_ANSWERS, required: true }, ...byFields }, { _id: false });

const noteSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ['draft', 'signed'], default: 'draft' },
    fromVisitId: { type: ObjectId, ref: 'Visit', default: null }, // the visit it was started from
    ...Object.fromEntries(Object.entries(NOTE_FIELDS).map(([k, max]) => [k, text(max)])),
    saved: stamp(),
    signed: stamp(),
    additions: { type: [new mongoose.Schema({ text: { type: String, maxlength: 1000 }, ...byFields }, { _id: false })], default: [] },
    rev: { type: Number, default: 0 },
  },
  { _id: false },
);

const referralSchema = new mongoose.Schema(
  {
    number: { type: String, required: true }, // REF-000001
    centre: { type: String, required: true, maxlength: 40 }, // a key of the admin's centres (referrals/settings.js)
    status: { type: String, enum: REFERRAL_STATUSES, default: 'open' },
    closed: reasonStamp(),
    cancelled: reasonStamp(),
    receivedAt: { type: Date, required: true }, // when it reached the hospital: the clocks start here
    // When the reply and seen promises fall due, worked out from receivedAt and the urgency with the settings of the
    // day it was logged (referrals/clocks.js duesFor) – so a later change of working hours or holidays never moves a
    // past clock. Worked out again only when receivedAt or the urgency is corrected, before anything happened.
    dues: { type: new mongoose.Schema({ reply: Date, seen: Date }, { _id: false }), default: null },
    via: { type: String, enum: REFERRAL_VIA, required: true },
    urgency: { type: String, enum: REFERRAL_URGENCY, required: true },
    referringDoctorId: { type: ObjectId, ref: 'ReferringDoctor', required: true },
    patientId: { type: ObjectId, ref: 'Patient', default: null },
    guest: {
      type: new mongoose.Schema(
        { name: { type: String, trim: true, maxlength: 150, required: true }, phone: text(30), ageYears: { type: Number, min: 0, max: 120, default: null } },
        { _id: false },
      ),
      default: null,
    },
    reasons: { type: [{ type: String, maxlength: 60 }], default: [] }, // keys of referrals/reasons.js
    otherReason: text(300),
    question: text(1000), // "the question you want answered"
    sent: { type: new mongoose.Schema(Object.fromEntries(SENT_FIELDS.map((k) => [k, text(200)])), { _id: false }), default: () => ({}) },
    consultantId: { type: ObjectId, ref: 'User', default: null }, // the hospital's doctor who will see her
    attachments: {
      type: [new mongoose.Schema({ fileId: { type: ObjectId, ref: 'StoredFile', required: true }, fileName: String, mediaType: String, size: Number, ...byFields }, { _id: false })],
      default: [],
      validate: [(v) => v.length <= MAX_ATTACHMENTS, `At most ${MAX_ATTACHMENTS} files per referral.`],
    },
    appointmentId: { type: ObjectId, ref: 'Appointment', default: null }, // the booking made for it
    sharing: { type: sharingSchema, default: null }, // her answer for the note and the discharge summary
    sharingHistory: { type: [sharingSchema], default: [] },
    firstSeen: {
      type: new mongoose.Schema({ at: Date, visitId: { type: ObjectId, ref: 'Visit', default: null }, admissionId: { type: ObjectId, ref: 'Admission', default: null } }, { _id: false }),
      default: null,
    },
    discharge: {
      type: new mongoose.Schema({ admissionId: { type: ObjectId, ref: 'Admission' }, documentId: { type: ObjectId, ref: 'ClinicalDocument' }, dischargedAt: Date }, { _id: false }),
      default: null,
    },
    note: { type: noteSchema, default: null },
    releases: {
      type: [
        new mongoose.Schema(
          {
            kind: { type: String, enum: RELEASE_KINDS, required: true },
            fileId: { type: ObjectId, ref: 'StoredFile', required: true },
            fileName: String,
            size: Number,
            documentId: { type: ObjectId, ref: 'ClinicalDocument', default: null }, // the discharge card released
            ...byFields,
            supersededAt: { type: Date, default: null }, // a newer release of the same kind replaced it
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    messages: {
      type: [new mongoose.Schema({ what: { type: String, enum: MESSAGE_KINDS, required: true }, releaseFileId: { type: ObjectId, default: null }, ...byFields }, { _id: false })],
      default: [],
    },
    reviews: {
      type: [new mongoose.Schema({ promise: { type: String, enum: REVIEW_PROMISES, required: true }, wentWrong: text(1000), changed: text(1000), ...byFields }, { _id: false })],
      default: [],
    },
    rev: { type: Number, default: 0 },
    clientRequestId: { type: String, required: true, maxlength: 64 },
    created: { type: stampSchema, required: true },
    updated: stamp(),
  },
  { timestamps: true, minimize: false },
);
referralSchema.plugin(tenantScoped);
// Exactly one of the two: her record, or what the doctor said of her before she is registered
referralSchema.pre('validate', function () {
  if (Boolean(this.patientId) === Boolean(this.guest)) this.invalidate('patientId', 'A referral needs her record or her name – not both.');
});
referralSchema.index({ tenantId: 1, number: 1 }, { unique: true });
referralSchema.index({ tenantId: 1, clientRequestId: 1 }, { unique: true });
referralSchema.index({ tenantId: 1, status: 1, receivedAt: -1 });
referralSchema.index({ tenantId: 1, patientId: 1, receivedAt: -1 });
referralSchema.index({ tenantId: 1, referringDoctorId: 1, receivedAt: -1 });
referralSchema.index({ tenantId: 1, receivedAt: -1 });

export const Referral = mongoose.model('Referral', referralSchema);
