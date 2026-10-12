import { describe, expect, it } from 'vitest';
import { forDocument } from './PrintPreview.jsx';

describe('forDocument', () => {
  it('nothing worked out yet is null – also without a docKey (consent forms, care-plan copies)', () => {
    expect(forDocument(null, undefined)).toBeNull();
    expect(forDocument(null, 'v1')).toBeNull();
  });
  it('only what was worked out for this document', () => {
    expect(forDocument({ key: 'v1', fit: 1 }, 'v1')).toEqual({ key: 'v1', fit: 1 });
    expect(forDocument({ key: 'v1', fit: 1 }, 'v2')).toBeNull();
  });
});
