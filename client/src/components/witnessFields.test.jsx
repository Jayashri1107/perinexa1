// Clinical Requirements Group C (PX-X-06): the second person's box asks for their own email and password, says it is
// not saved, and a saved check reads "Checked by Name (Role), time". Fake sample data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WitnessFields, emptyWitness, witnessWords } from './WitnessFields.jsx';

describe('the second-person box', () => {
  it('asks for the second person’s email and a password field, and says only the name and time are kept', () => {
    const out = renderToStaticMarkup(<WitnessFields id="w" value={emptyWitness()} onChange={() => {}} what="The identity band" />);
    expect(out).toContain('type="password"');
    expect(out).toContain('autoComplete="new-password"');
    expect(out.replace(/<[^>]+>/g, ' ')).toContain('The identity band is checked by two people');
    expect(out.replace(/<[^>]+>/g, ' ')).toContain('it is not saved, only their name and the time');
  });
  it('a saved check in words', () => {
    expect(witnessWords({ byName: 'Sample nurse', role: 'Nurse', at: '2026-11-10T05:00:00Z' }, () => '10 Nov 2026, 10:30')).toBe('Checked by Sample nurse (Nurse), 10 Nov 2026, 10:30');
    expect(witnessWords(null, () => '')).toBe('');
  });
});
