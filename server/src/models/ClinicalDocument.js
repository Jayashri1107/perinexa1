import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';
import { DOC_KINDS } from '../inpatient/docSchemas.js';

// An inpatient document (Version 2): an admission note, a daily round note, a delivery note, an operation note or a
// discharge card. Written as a draft (by an RMO or a doctor), then signed – admission and round notes by the doctor
// or RMO who writes them, the others confirmed by a doctor (USE_CASE §3). Signed: locked; a correction or addition
// is added below it (who, when) and never changed or removed. A document written by mistake is marked "entered in
// error" with a reason. Never deleted. content: the kind's fields (inpatient/docSchemas.js).

const { ObjectId } = mongoose.Schema.Types;
const documentSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    admissionId: { type: ObjectId, ref: 'Admission', required: true },
    kind: { type: String, enum: DOC_KINDS, required: true },
    status: { type: String, enum: ['draft', 'signed', 'cancelled'], default: 'draft' },
    content: { type: mongoose.Schema.Types.Mixed, default: {} },
    rev: { type: Number, default: 0 },
    createdBy: { type: ObjectId, ref: 'User', required: true },
    createdByName: { type: String, required: true },
    savedBy: { type: ObjectId, ref: 'User', default: null },
    savedByName: { type: String, default: null },
    savedAt: { type: Date, default: null },
    signed: {
      type: new mongoose.Schema(
        { by: { type: ObjectId, ref: 'User', required: true }, byName: String, role: String, at: Date, rev: Number },
        { _id: false },
      ),
      default: null,
    },
    cancelled: {
      type: new mongoose.Schema({ reason: String, by: ObjectId, byName: String, at: Date }, { _id: false }),
      default: null,
    },
    additions: {
      type: [new mongoose.Schema({ text: { type: String, required: true, maxlength: 2000 }, by: ObjectId, byName: String, at: Date })],
      default: [],
    },
    clientRequestId: { type: String, required: true, maxlength: 64 },
  },
  { timestamps: true, minimize: false },
);
documentSchema.plugin(tenantScoped);
documentSchema.index({ tenantId: 1, admissionId: 1, createdAt: 1 });
documentSchema.index({ tenantId: 1, status: 1, kind: 1 });
// Delivery notes by the time of delivery (Analytics → Deliveries reads the confirmed ones of a period): only delivery
// notes are in this index.
documentSchema.index({ tenantId: 1, kind: 1, status: 1, 'content.deliveredAt': 1 }, { partialFilterExpression: { kind: 'delivery' } });
documentSchema.index({ tenantId: 1, clientRequestId: 1 }, { unique: true });

export const ClinicalDocument = mongoose.model('ClinicalDocument', documentSchema);
