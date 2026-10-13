// Beds: the bed names the admin types, and the free beds offered for an admission or a move (no browser needed).
import { describe, expect, it } from 'vitest';
import { bedNames, freeBeds } from './bedFormat.js';

describe('bed names typed by the hospital admin', () => {
  it('a range keeps the letters before the numbers; commas list names; repeats are dropped', () => {
    expect(bedNames('G1-G4')).toEqual(['G1', 'G2', 'G3', 'G4']);
    expect(bedNames('G8–10')).toEqual(['G8', 'G9', 'G10']);
    expect(bedNames('1-3')).toEqual(['1', '2', '3']);
    expect(bedNames('P1, P2, P2 , Labour room')).toEqual(['P1', 'P2', 'Labour room']);
    expect(bedNames('')).toEqual([]);
  });
  it('a backwards or very long range is kept as typed, not turned into hundreds of beds', () => {
    expect(bedNames('G9-G2')).toEqual(['G9-G2']);
    expect(bedNames('1-500')).toEqual(['1-500']);
  });
});

describe('free beds', () => {
  it('only beds in use with nobody in them, named with their ward', () => {
    const wards = [
      { ward: 'General', beds: [{ id: 'a', name: 'G1', active: true, stay: null }, { id: 'b', name: 'G2', active: true, stay: { id: 's' } }, { id: 'c', name: 'G3', active: false, stay: null }] },
      { ward: 'Private', beds: [{ id: 'd', name: 'P1', active: true, stay: null }] },
    ];
    expect(freeBeds(wards).map((b) => b.label)).toEqual(['General · G1', 'Private · P1']);
    expect(freeBeds()).toEqual([]);
  });
});
