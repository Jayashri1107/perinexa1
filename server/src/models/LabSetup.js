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
  },
  { timestamps: true },
);
setupSchema.plugin(tenantScoped);
setupSchema.index({ tenantId: 1, set: 1 }, { unique: true });

export const LabSetup = mongoose.model('LabSetup', setupSchema);
