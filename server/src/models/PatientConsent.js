import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// A consent form printed for one patient: which form (and its version), in which languages, what the doctor
// typed into its blanks, which of her high-risk factors were printed on it, and who printed it when. The signed paper is the consent: "signed" records that the
// signed copy came back – the date it was signed, the witness and where the paper is kept – once, never changed.
// scans: scanned copies of the signed paper (Version 2, utils/storedFiles.js). Clinical information: shown only to those who may see
// the patient's medical details; the audit log gets ids only.

const consentSchema = new mongoose.Schema(
  {
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
    formId: { type: mongoose.Schema.Types.ObjectId, ref: 'ConsentForm', required: true },
    formKey: { type: String, required: true, maxlength: 60 },
    kind: { type: String, enum: ['consent', 'information'], default: 'consent' }, // the form's kind when printed
    formVersion: { type: Number, required: true },
    formApproved: { type: Boolean, required: true }, // false: printed while the form was a draft ("DRAFT" on the paper)
    title: { type: String, required: true, maxlength: 150 }, // the English title when printed (the form may be renamed later)
    language: { type: String, enum: ['en', 'mr', 'hi'], required: true }, // printed next to English ('en' = English only)
    procedure: { type: String, trim: true, maxlength: 200, default: '' },
    reason: { type: String, trim: true, maxlength: 300, default: '' },
    condition: { type: String, trim: true, maxlength: 200, default: '' }, // information forms: the condition explained
    doctorName: { type: String, maxlength: 150, default: null }, // null: left blank to fill in by hand
    // The high-risk factors printed on the form (consents/riskWording.js), as chosen by the doctor: the English
    // name and complications as printed. riskOffered: the ids of the factors her record showed then (ticked or not),
    // so that "Print again" repeats the doctor's choice for those and treats a factor that is new since as new.
    // otherRisks: what the doctor typed as other risk factors. riskWordingVersion / riskWordingApproved: the wording
    // on the paper – false = it was a draft when printed ("DRAFT" on the paper); null = the section was not printed.
    riskFactors: {
      type: [new mongoose.Schema({ id: { type: String, maxlength: 80 }, name: { type: String, maxlength: 200 }, complications: { type: String, maxlength: 600, default: '' } }, { _id: false })],
      default: [],
    },
    riskOffered: { type: [{ type: String, maxlength: 80 }], default: [] },
    otherRisks: { type: String, trim: true, maxlength: 300, default: '' },
    riskWordingVersion: { type: Number, default: null },
    riskWordingApproved: { type: Boolean, default: null },
    // The same print sent twice (double click, retry) is saved once.
    clientRequestId: { type: String, required: true, maxlength: 64 },
    printedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    printedByName: { type: String, required: true, maxlength: 150 },
    printedAt: { type: Date, required: true },
    signed: {
      type: new mongoose.Schema(
        {
          on: { type: Date, required: true }, // the day it was signed (the hospital's date, midnight UTC)
          witness: { type: String, trim: true, maxlength: 150, default: '' },
          keptAt: { type: String, trim: true, maxlength: 200, default: '' }, // e.g. "Patient's paper file"
          recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
          recordedByName: { type: String, required: true, maxlength: 150 },
          recordedAt: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    scans: {
      type: [
        new mongoose.Schema(
          { fileId: mongoose.Schema.Types.ObjectId, fileName: String, mediaType: String, size: Number, by: mongoose.Schema.Types.ObjectId, byName: String, at: Date },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { timestamps: false },
);
consentSchema.plugin(tenantScoped);
consentSchema.index({ tenantId: 1, patientId: 1, printedAt: -1 });
consentSchema.index({ tenantId: 1, patientId: 1, kind: 1, printedAt: -1 });
consentSchema.index({ tenantId: 1, clientRequestId: 1 }, { unique: true });

consentSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.printedBy;
    if (ret.signed) delete ret.signed.recordedBy;
    ret.scans = (ret.scans ?? []).map((f) => ({ id: String(f.fileId), fileName: f.fileName, mediaType: f.mediaType, size: f.size, byName: f.byName, at: f.at }));
    delete ret.clientRequestId;
    delete ret.tenantId;
    return ret;
  },
});

export const PatientConsent = mongoose.model('PatientConsent', consentSchema);
