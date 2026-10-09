// A doctor's order for a patient in hospital (owner, 9 Oct 2026): a medicine (dose, route, the times of day it is
// due – none for "as needed"), an IV fluid (fluid, volume, rate) or a care task (dressing, catheter care … at set
// times). Written by a doctor or RMO; nurses chart against it (NursingEntry: dose, iv, task) and never change it.
// An order is never changed or deleted: it is stopped, with who, when and why, and a new one written instead.
import mongoose from '../../db/mongoose.js';
import { hospitalScoped } from '../../db/hospitalScoped.js';

const { ObjectId } = mongoose.Schema.Types;
export const ORDER_TYPES = ['medicine', 'iv', 'task'];
const stampSchema = new mongoose.Schema({ by: ObjectId, byName: String, at: Date, reason: String }, { _id: false });

const careOrderSchema = new mongoose.Schema(
  {
    patientId: { type: ObjectId, ref: 'Patient', required: true },
    admissionId: { type: ObjectId, ref: 'Admission', required: true },
    type: { type: String, enum: ORDER_TYPES, required: true },
    medicine: { drug: String, dose: String, route: String, food: String },
    iv: { fluid: String, volumeMl: Number, rateMlPerHour: Number },
    task: { text: String },
    // "HH:MM" in the hospital's time; empty = as needed (medicine) – a task always has at least one
    times: { type: [String], default: [] },
    instructions: { type: String, trim: true, maxlength: 300, default: '' },
    status: { type: String, enum: ['active', 'stopped'], default: 'active' },
    ordered: { type: stampSchema, required: true },
    stopped: { type: stampSchema, default: null },
    clientRequestId: { type: String, required: true, maxlength: 64 },
  },
  { timestamps: true },
);
careOrderSchema.plugin(hospitalScoped);
careOrderSchema.index({ hospitalId: 1, admissionId: 1, status: 1 });
careOrderSchema.index({ hospitalId: 1, clientRequestId: 1 }, { unique: true });

export const CareOrder = mongoose.model('CareOrder', careOrderSchema, 'care_orders');
