// One entry of a hospital's clinic library (care-plan template, rule set, medicine safety list, consent or
// information form, test package, prescription set). `content` holds the entry's own data, checked by kind in
// library.validation.js. An entry is a DRAFT until a doctor approves it; any change makes it a draft again (the
// version counts up, and the approval names the version it was for). Entries are never deleted – an entry the
// hospital doesn't use is made inactive.
import mongoose from '../../db/mongoose.js';
import { hospitalScoped } from '../../db/hospitalScoped.js';
import { CARE_TYPE_KEYS } from '../../config/index.js';
import { KIND_KEYS } from './library.content.js';

const { ObjectId } = mongoose.Schema.Types;

const libraryEntrySchema = new mongoose.Schema(
  {
    kind: { type: String, enum: KIND_KEYS, required: true, immutable: true },
    key: { type: String, required: true, trim: true, maxlength: 60, immutable: true },
    origin: { type: String, enum: ['built_in', 'hospital'], required: true, immutable: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    careTypes: { type: [{ type: String, enum: CARE_TYPE_KEYS }], default: [] }, // empty = every type of care
    about: { type: String, trim: true, maxlength: 5000, default: '' }, // notes for doctors (never printed)
    content: { type: mongoose.Schema.Types.Mixed, required: true },
    status: { type: String, enum: ['draft', 'approved'], default: 'draft' },
    version: { type: Number, default: 1 },
    approved: {
      type: new mongoose.Schema({ by: { type: ObjectId, ref: 'User' }, at: Date, version: Number }, { _id: false }),
      default: null,
    },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 10000 },
    createdBy: { type: ObjectId, ref: 'User', default: null },
    updatedBy: { type: ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, minimize: false },
);
libraryEntrySchema.plugin(hospitalScoped);
libraryEntrySchema.index({ hospitalId: 1, kind: 1, key: 1 }, { unique: true });
libraryEntrySchema.index({ hospitalId: 1, kind: 1, order: 1 });
libraryEntrySchema.index({ hospitalId: 1, status: 1, isActive: 1 });

export const LibraryEntry = mongoose.model('LibraryEntry', libraryEntrySchema, 'library_entries');
