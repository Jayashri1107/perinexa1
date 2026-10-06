// The sections of Hospital settings (the same keys as the server's SETTINGS_SECTIONS): each a tab with its own form.
// languages: [{ value, label }] from the server's settings.
export const HOSPITAL_SETTINGS_SECTIONS = [
  {
    key: 'letterhead',
    label: 'Print letterhead',
    description: 'Printed at the top and bottom of prescriptions, care plans and other papers.',
    fields: ({ languages }) => [
      { name: 'name', label: 'Printed name', width: 'half', help: 'Leave empty to print the hospital name.' },
      { name: 'tagline', label: 'Tagline', width: 'half', placeholder: "e.g. Maternity & Women's Care" },
      { name: 'address', label: 'Address', type: 'textarea', rows: 2 },
      { name: 'phone', label: 'Phone', width: 'third' },
      { name: 'email', label: 'Email', type: 'email', width: 'third' },
      { name: 'registrationNumber', label: 'Hospital registration number', width: 'third' },
      { name: 'footer', label: 'Footer', type: 'textarea', rows: 2, help: 'e.g. emergency number, timings.' },
      { name: 'consentLanguage', label: 'Second language on patient papers', type: 'select', required: true, options: languages, width: 'half', help: 'Printed next to English.' },
    ],
  },
  {
    key: 'messaging',
    label: 'Patient messages',
    description: 'What patients receive from the hospital. These switches are used by the reminder and patient-portal modules.',
    fields: () => [
      { name: 'remindersEnabled', label: 'Automatic visit reminders (SMS / WhatsApp)', type: 'switch', help: 'Only to patients who agreed to receive messages.' },
      { name: 'portalEnabled', label: 'Patient portal', type: 'switch', help: 'Patients can see their own appointments and papers.' },
      { name: 'portalBooking', label: 'Booking in the patient portal', type: 'switch', help: 'Needs the patient portal switched on.' },
      { name: 'whatsappDocuments', label: 'Send prescriptions on WhatsApp in one click', type: 'switch' },
    ],
  },
  {
    key: 'abdm',
    label: 'ABDM',
    description: "The hospital's IDs for India's digital health mission (ABHA linking and Scan & Share).",
    fields: () => [
      { name: 'hfrId', label: 'Health Facility Registry ID (HFR)', width: 'half' },
      { name: 'hipId', label: 'HIP ID', width: 'half', help: 'Usually the same as the HFR ID.' },
      { name: 'counterCode', label: 'Scan & Share counter code', width: 'half' },
    ],
  },
];

// The saved values of a section, ready for its form.
export function sectionValues(settings, section) {
  const saved = settings?.[section.key] ?? {};
  const fields = section.fields({ languages: [] });
  return Object.fromEntries(fields.map((f) => [f.name, saved[f.name] ?? (f.type === 'switch' ? false : '')]));
}
