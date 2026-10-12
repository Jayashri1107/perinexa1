import { describe, expect, it } from 'vitest';
import { historyText } from './VisitSignature.jsx';

describe('historyText', () => {
  it('says which parts were saved, never what was written', () => {
    expect(historyText({ action: 'VISIT_UPDATED', sections: ['vitals'] })).toBe('Saved the vital signs');
    expect(historyText({ action: 'VISIT_UPDATED', sections: ['vitals', 'details'] })).toBe('Saved the vital signs and the visit details');
    expect(historyText({ action: 'VISIT_SIGNED' })).toBe('Signed and finished');
    expect(historyText({ action: 'PRESCRIPTION_PDF_SAVED', via: 'whatsapp' })).toBe('Saved the prescription as a PDF, to send on WhatsApp');
  });
});
