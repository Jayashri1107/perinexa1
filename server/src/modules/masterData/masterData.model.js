// One collection for every master-data list (departments, specialities …). The lists themselves are named in
// config.masterData.types, so a new list needs a line of config, not new code.
import mongoose from '../../db/mongoose.js';
import { MASTER_TYPE_KEYS } from '../../config/index.js';

const { ObjectId } = mongoose.Schema.Types;

const masterDataSchema = new mongoose.Schema(
  {
    type: { type: String, enum: MASTER_TYPE_KEYS, required: true, immutable: true },
    // a short fixed code, used by other records and reports; it never changes once created
    code: { type: String, required: true, uppercase: true, trim: true, immutable: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

masterDataSchema.index({ type: 1, code: 1 }, { unique: true });
masterDataSchema.index({ type: 1, isActive: 1, sortOrder: 1, name: 1 });

export const MasterData = mongoose.model('MasterData', masterDataSchema, 'master_data');
