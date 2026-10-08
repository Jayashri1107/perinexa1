import { z } from 'zod';
import { CARE_TYPE_KEYS, SEX_KEYS, config } from '../../config/index.js';
import { listQuery } from '../../core/pagination.js';
import { name, objectId, optional, optionalText, toObjectId } from '../../core/validate.js';

// Mobile numbers: exactly 10 digits, nothing else (spaces typed in between are taken out first).
const digitsOnly = (v) => (typeof v === 'string' ? v.replace(/\s+/g, '') : v);
const MOBILE_MESSAGE = 'Enter the 10-digit mobile number (digits only)';
const mobile = z.preprocess(digitsOnly, z.string(MOBILE_MESSAGE).regex(/^\d{10}$/, MOBILE_MESSAGE));
const phone = z.preprocess(digitsOnly, z.string().regex(/^(\d{10})?$/, MOBILE_MESSAGE).default(''));

// The ID proof's number, by type (letters in capitals, no spaces). Aadhaar: only its last 4 digits are ever kept.
export const ID_FORMATS = {
  aadhaar: [/^\d{4}$/, 'Aadhaar: type only the last 4 digits'],
  voter_id: [/^[A-Z]{3}\d{7}$/, 'Voter ID: 3 letters and 7 digits, e.g. ABC1234567'],
  pan: [/^[A-Z]{5}\d{4}[A-Z]$/, 'PAN: 5 letters, 4 digits, 1 letter, e.g. ABCDE1234F'],
  driving_licence: [/^[A-Z]{2}\d{2}[A-Z0-9]{9,14}$/, 'Driving licence: e.g. MH2020123456789 (no spaces)'],
  passport: [/^[A-Z]\d{7}$/, 'Passport: 1 letter and 7 digits, e.g. A1234567'],
  ration_card: [/^[A-Z0-9]{6,20}$/, 'Ration card: 6–20 letters or digits'],
  other: [/^[A-Z0-9/-]{4,30}$/, 'ID number: 4–30 letters or digits'],
};
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
  phone: mobile,
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
  // Her relative or attendant: required (owner, 8 Oct 2026).
  emergencyContact: z.object(
    {
      name: z.string('Enter the relative’s name').trim().min(2, 'Enter the relative’s name').max(100),
      relation: z.string('Enter the relation, e.g. husband').trim().min(2, 'Enter the relation, e.g. husband').max(50),
      phone: mobile,
    },
    'Enter the relative’s details',
  ),
  // The ID proof seen: required (owner, 8 Oct 2026) – the full number, except Aadhaar: its last 4 digits only.
  // TODO before real use: keep ID numbers encrypted (DPDP Act 2023).
  idProof: z
    .object(
      {
        kind: z.enum(config.patients.idProofTypes.map((t) => t.key), 'Choose the type of ID proof'),
        number: z.string('Enter the ID number').trim().toUpperCase().transform((v) => v.replace(/\s+/g, '')),
      },
      'Choose the ID proof and enter its number',
    )
    .superRefine((v, ctx) => {
      const [rx, message] = ID_FORMATS[v.kind] ?? ID_FORMATS.other;
      if (!rx.test(v.number)) ctx.addIssue({ code: 'custom', path: ['number'], message });
    }),
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
