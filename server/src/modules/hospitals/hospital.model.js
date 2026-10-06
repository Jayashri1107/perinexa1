import mongoose from '../../db/mongoose.js';

const { ObjectId } = mongoose.Schema.Types;

const hospitalSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    // lower-case copy of the name: two hospitals cannot share a name, whatever the capitals
    nameKey: { type: String, required: true, unique: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, immutable: true },
    email: { type: String, trim: true, lowercase: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    address: {
      line: { type: String, trim: true, default: '' },
      city: { type: String, trim: true, default: '' },
      state: { type: String, trim: true, default: '' },
      pincode: { type: String, trim: true, default: '' },
    },
    // master data items of the type config.masterData.hospitalDepartmentType
    departments: [{ type: ObjectId, ref: 'MasterData' }],
    isActive: { type: Boolean, default: true },
    createdBy: { type: ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

hospitalSchema.pre('validate', function () {
  if (this.name) this.nameKey = this.name.trim().toLowerCase();
});

hospitalSchema.index({ isActive: 1, name: 1 });
hospitalSchema.index({ departments: 1 });

export const Hospital = mongoose.model('Hospital', hospitalSchema, 'hospitals');
