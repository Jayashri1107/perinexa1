// My settings forms.
export const professionalFields = [
  { name: 'qualification', label: 'Qualification', placeholder: 'e.g. MBBS, MS (OBGY)' },
  { name: 'registrationNumber', label: 'Registration number', width: 'half' },
  { name: 'council', label: 'Medical council', width: 'half', placeholder: 'e.g. Maharashtra Medical Council' },
];

export const professionalValues = (user) => ({
  qualification: user.professional?.qualification ?? '',
  registrationNumber: user.professional?.registrationNumber ?? '',
  council: user.professional?.council ?? '',
});

// textSize and density: [{ value, label }] from the server's settings.
export const appearanceFields = ({ textSize, density }) => [
  { name: 'textSize', label: 'Text size', type: 'select', required: true, options: textSize, width: 'half' },
  { name: 'density', label: 'Spacing', type: 'select', required: true, options: density, width: 'half' },
];

export const appearanceValues = (user, appearance) => ({
  textSize: user.preferences?.textSize ?? appearance.textSize[0].key,
  density: user.preferences?.density ?? appearance.density[0].key,
});
