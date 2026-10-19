import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';

// The lab's settings for a hospital (Lab → Settings, a doctor changes them; docs/LAB_LIMS_PLAN.md feature 5):
//  - verify: results are checked by a second person before they go to the doctor ("Report results" by the person
//    who entered them only marks them entered);
//  - verifierIds: who may check them (lab staff, doctors or RMOs of this hospital); none = any of them – never the
//    person who entered the results.
// One document per hospital; none = the defaults (no check).

const setupSchema = new mongoose.Schema(
  {
    set: { type: String, enum: ['lab'], default: 'lab' }, // one per hospital (see the unique index)
    verify: { type: Boolean, default: false },
    verifierIds: { type: [mongoose.Schema.Types.ObjectId], ref: 'User', default: [] },
    updatedByName: { type: String, default: '' },
    // Who signs the printed lab report (report templates – docs/LAB_TEMPLATES_PLAN.md part 4): a pathologist or the lab
    // in charge, with qualification, registration number and a picture of the signature. The picture prints only on a
    // report this person checked (or reported); otherwise the default signer's name prints with a line to sign by hand.
    // Never deleted: one no longer signing is made inactive.
    signatories: {
      type: [
        new mongoose.Schema({
          name: { type: String, trim: true, maxlength: 100, required: true },
          title: { type: String, trim: true, maxlength: 80, default: '' }, // "Consultant pathologist"
          qualification: { type: String, trim: true, maxlength: 100, default: '' }, // "MD (Pathology)"
          regNo: { type: String, trim: true, maxlength: 60, default: '' }, // medical council registration number
          userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // the staff member who checks
          signature: { type: String, default: '' }, // a PNG or JPEG as a data: address, at most about 150 KB
          isDefault: { type: Boolean, default: false },
          active: { type: Boolean, default: true },
        }),
      ],
      default: [],
    },
  },
  { timestamps: true },
);
setupSchema.plugin(tenantScoped);
setupSchema.index({ tenantId: 1, set: 1 }, { unique: true });

export const LabSetup = mongoose.model('LabSetup', setupSchema);
