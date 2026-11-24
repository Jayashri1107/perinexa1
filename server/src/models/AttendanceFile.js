import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// Payroll, Stage B (docs/PAYROLL_BUILD_NOTE.md section 5): an attendance file as it was read for a month – the bytes
// themselves and their SHA-256, the layout it was read with, who read it and when. Its own collection on purpose:
// StoredFile's rule is "a file belongs to a patient" and its check is PDF-or-photo; neither is loosened for this.
// The bytes are not selected unless asked for and never leave the server through a list. A file read by mistake is
// marked removed (who, when, why) – its rows leave the month's run, the record stays.
// For the accounts login and the hospital admin only (routes/payrollRuns.js); not part of the hospital export.
const fileSchema = new mongoose.Schema(
  {
    month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    fileName: { type: String, trim: true, maxlength: 200, default: '' },
    size: { type: Number, required: true },
    sha256: { type: String, required: true },
    bytes: { type: Buffer, required: true, select: false },
    shape: { type: String, enum: ['register', 'days', 'summary'], required: true },
    layout: { type: mongoose.Schema.Types.Mixed, required: true },
    rows: { type: Number, default: 0 }, // rows of the file
    people: { type: Number, default: 0 }, // people read from it
    readByName: { type: String, default: '' },
    removed: { type: new mongoose.Schema({ byName: String, at: Date, reason: String }, { _id: false }), default: null },
  },
  { timestamps: true },
);
fileSchema.plugin(tenantScoped);
fileSchema.index({ tenantId: 1, month: 1, createdAt: 1 });

export const AttendanceFile = mongoose.model('AttendanceFile', fileSchema);
