// PIN code → city and state from the list inside Perinexa (client/public/pincodes.json).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { placeOf } from './pinLookup.js';

const data = JSON.parse(readFileSync(new URL('../../../public/pincodes.json', import.meta.url), 'utf8'));

describe('PIN code to city and state', () => {
  it('gives the district and state of a PIN', () => {
    expect(placeOf(data, '411001')).toEqual({ city: 'Pune', state: 'Maharashtra' });
    expect(placeOf(data, '413512')).toEqual({ city: 'Latur', state: 'Maharashtra' });
    expect(placeOf(data, '110001')).toEqual({ city: 'New Delhi', state: 'Delhi' });
  });
  it('knows nothing of a PIN not in the list', () => {
    expect(placeOf(data, '000000')).toBeNull();
  });
  it('uses only the state names the form offers', () => {
    expect(data.states).toContain('Maharashtra');
    expect(Object.keys(data.pins).length).toBeGreaterThan(19000);
  });
});
