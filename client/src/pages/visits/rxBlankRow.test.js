import { describe, expect, it } from 'vitest';
import { emptyRow, isBlankRow } from './rxRows.js';

describe('isBlankRow', () => {
  it('an untouched row (any form) is blank; anything typed makes it a medicine to check', () => {
    expect(isBlankRow(emptyRow())).toBe(true);
    expect(isBlankRow({ ...emptyRow(), form: 'syrup' })).toBe(true);
    expect(isBlankRow({ ...emptyRow(), drug: 'Folic acid' })).toBe(false);
    expect(isBlankRow({ ...emptyRow(), frequency: '1-0-0' })).toBe(false);
    expect(isBlankRow({ ...emptyRow(), instructions: ' ' })).toBe(true);
  });
});
