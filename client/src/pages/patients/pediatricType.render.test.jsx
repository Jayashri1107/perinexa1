// New patient → Pediatric department (14 Nov 2026): the form's Type of care shows the choice made – Pediatric –
// Follow-up or Pediatric – Vaccination – and editing a record shows one Pediatric department. Rendered to HTML, no
// browser. Fake sample data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { PatientForm } from './PatientForm.jsx';

const FULL = { canEditIdentity: true, canEditNewborn: true, canEditClinical: false };
const OLDER_BABY = { department: 'Pediatric', newborn: { birthTimeKnown: false } };
const html = (node) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
const registering = (pediatricFor) =>
  html(<PatientForm careType="newborn" part="info" prefill={OLDER_BABY} pediatricFor={pediatricFor} access={FULL} onCareTypeChange={() => {}} onSubmit={() => {}} />);
const selected = (out) => out.match(/<select id="careType"[\s\S]*?<\/select>/)[0].match(/<option value="([^"]+)" selected="">([^<]+)</)?.slice(1);

describe('Type of care for an older baby', () => {
  it('registering: Follow-up shows Pediatric – Follow-up, Vaccination shows Pediatric – Vaccination', () => {
    expect(selected(registering('followup'))).toEqual(['newborn:followup', 'Pediatric – Follow-up']);
    expect(selected(registering('vaccination'))).toEqual(['newborn:vaccination', 'Pediatric – Vaccination']);
  });

  it('registering: both choices are in the list, and no mixed "follow-up or vaccination" one', () => {
    const out = registering('followup').match(/<select id="careType"[\s\S]*?<\/select>/)[0];
    expect(out).toContain('Pediatric – Follow-up');
    expect(out).toContain('Pediatric – Vaccination');
    expect(out).not.toMatch(/follow-up or vaccination/i);
  });
});
