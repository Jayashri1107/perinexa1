import { z } from 'zod';
import { CARE_TYPE_KEYS, SEX_KEYS, config } from '../../config/index.js';
import { listQuery } from '../../core/pagination.js';
import { name, objectId, optional, optionalText, toObjectId } from '../../core/validate.js';

const phone = z.string().trim().regex(/^[0-9+\-\s]{0,20}$/, 'Enter a valid phone number').default('');
const pastDate = z.coerce.date().refine((d) => d <= new Date(), 'The date cannot be in the future');
const dateOnly = optional(pastDate);
const count = optional(z.coerce.number().int().min(0).max(20));

export const patientParams = z.object({ id: objectId });

export const patientListQuery = listQuery({
  sortFields: ['createdAt', 'name', 'patientNumber', 'edd'],
  defaultSort: '-createdAt',
  extra: {
    careType: z.enum(CARE_TYPE_KEYS).optional(),
    status: z.enum(['active', 'closed']).optional(),
    doctorId: optional(objectId.transform(toObjectId)),
    mine: z.enum(['true', 'false']).optional(),
  },
});

// Who she is and how to reach her (reception may change these).
const contact = {
  name: name('Name', 120),
  birthDate: dateOnly,
  ageYears: optional(z.coerce.number().int().min(0).max(120)),
  sex: z.enum(SEX_KEYS, 'Choose the sex'),
  phone,
  alternatePhone: phone,
  address: z
    .object({
      line: optionalText(200),
      city: optionalText(80),
      state: optionalText(80),
      pincode: z.string().trim().regex(/^[0-9]{0,6}$/, 'PIN code: up to 6 digits').default(''),
    })
    .default({}),
  abhaNumber: z.string().trim().regex(/^[0-9-]{0,20}$/, 'ABHA number: digits only').default(''),
  consentMessages: z.boolean().default(false),
  assignedDoctorId: optional(objectId),
  careType: z.enum(CARE_TYPE_KEYS, 'Choose the type of care').default(CARE_TYPE_KEYS[0]),
  lmp: dateOnly,
};

const birthOrAge = (d, ctx) => {
  if (!d.birthDate && d.ageYears === undefined) {
    ctx.addIssue({ code: 'custom', path: ['ageYears'], message: 'Give the date of birth or the age' });
  }
};

export const registerBody = z
  .object({ ...contact, confirmDuplicate: z.boolean().default(false) })
  .superRefine(birthOrAge);

export const contactBody = z.object(contact).superRefine(birthOrAge);

// Clinical details (her doctor, RMOs).
export const clinicalBody = z.object({
  careType: z.enum(CARE_TYPE_KEYS, 'Choose the type of care'),
  lmp: dateOnly,
  edd: optional(z.coerce.date()),
  gravida: count,
  para: count,
  bloodGroup: z.enum(['', ...config.patients.bloodGroups]).default(''),
  allergies: optionalText(300),
  notes: optionalText(2000),
  isSensitive: z.boolean().default(false),
});

export const duplicateQuery = z.object({ name: z.string().trim().max(120).default(''), phone: z.string().trim().max(20).default('') });

export const emergencyBody = z.object({ reason: z.string().trim().min(10, 'Write the reason (at least 10 characters)').max(300) });

export const statusBody = z.object({ status: z.enum(['active', 'closed']) });
