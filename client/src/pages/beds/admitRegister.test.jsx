// Admitting someone not registered yet: register her from the Aadhaar card in the admit dialog (17 Oct 2026).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdmitRegister } from './AdmitRegister.jsx';

describe('register her in the admit dialog', () => {
  it('offers registering from the Aadhaar card', () => {
    expect(renderToStaticMarkup(<AdmitRegister onRegistered={() => {}} />)).toContain('Not registered yet? Register her here (from the Aadhaar card)');
  });
});
