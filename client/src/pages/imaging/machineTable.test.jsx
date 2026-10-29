// The ultrasound machine's readings on the screen (docs/USG_MACHINE_PLAN.md; rendered to HTML, no browser): the
// average table's rules (the same as the server's), the table with each reading's tick and the value used, the
// pictures with the PCPNDT confirmation, and the machine's readings in the report. Made-up data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MachineReadingsTable } from './ImagingPages.jsx';
import { AverageTable, MachinePictures } from './MachinePanel.jsx';
import { startChoices, usedValue, usesFor } from './machineTable.js';

const html = (node) => renderToStaticMarkup(node).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const text = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const BPD = { key: 'bpd', name: 'BPD', unit: 'mm', readings: [78.1, 78.6, 77.9], machine: { value: 78.2, derived: 'mean' }, inTemplate: true };
const HC = { key: 'hc', name: 'Head circumference', unit: 'mm', readings: [285, 289], machine: null, inTemplate: true };
const AFI = { key: 'afi', name: 'AFI', unit: 'cm', readings: [], machine: { value: 12.1, derived: 'mean' }, inTemplate: true };
const NT = { key: 'nt', name: 'NT', unit: 'mm', readings: [1.4], machine: null, inTemplate: false };
const study = (over = {}) => ({ id: 's1', rev: 3, status: 'done', access: { canReport: true, canImages: true }, ...over });
const machineStudy = { id: 'm1', images: [{ id: 'i1', inThisStudy: true }, { id: 'i2', inThisStudy: false }], fetuses: [{ fetus: 'A', rows: [BPD, HC, AFI, NT] }], unmatched: [{ meaning: 'Transcerebellar diameter', value: 35.1, unit: 'mm', fetus: 'A' }] };

describe('the average table rules', () => {
  it('average, last, the machine\'s own, one reading; unticked readings left out', () => {
    expect(usedValue(BPD)).toBe(78.2);
    expect(usedValue(BPD, { ticked: [true, false, true] })).toBe(78);
    expect(usedValue(BPD, { use: 'last' })).toBe(77.9);
    expect(usedValue(BPD, { use: 'machine' })).toBe(78.2);
    expect(usedValue(BPD, { use: 'reading', reading: 1 })).toBe(78.6);
    expect(usedValue(BPD, { ticked: [false, false, false] })).toBeNull();
    expect(usedValue(AFI)).toBe(12.1);
    expect(usedValue({ ...HC, unit: 'g', readings: [1849.6, 1850.2] })).toBe(1850);
  });

  it('the rules a row offers, and where it starts', () => {
    expect(usesFor(BPD)).toEqual(['average', 'last', 'machine', 'reading']);
    expect(usesFor(HC)).toEqual(['average', 'last', 'reading']);
    expect(usesFor(AFI)).toEqual(['machine']);
    expect(startChoices([BPD, AFI, NT])).toEqual({
      bpd: { ticked: [true, true, true], use: 'average', reading: 0, on: true },
      afi: { ticked: [], use: 'machine', reading: 0, on: true },
      nt: { ticked: [true], use: 'average', reading: 0, on: false },
    });
  });
});

describe('from the machine on the scan page', () => {
  it('the table: each reading with its tick, the machine\'s value, the rule and the value used; a row not in the template', () => {
    const out = html(<AverageTable s={study()} m={machineStudy} defaultUse="average" onSaved={() => {}} onError={() => {}} />);
    const words = text(out);
    expect(words).toContain('BPD (mm) 78.1 78.6 77.9 78.2');
    expect(words).toContain('78.2'); // the average of the three
    expect(words).toContain('Head circumference (mm) 285 289 –');
    expect(words).toContain('287');
    expect(words).toContain("AFI (cm) 12.1 Machine's own 12.1");
    expect(words).toContain('NT (mm) 1.4');
    expect(words).toContain('Not in this template');
    expect(words).toContain('1 measurement not matched to a template field');
    expect(out).toContain('aria-label="BPD reading 2"');
    expect(words).toContain('Fill the report with these values');
    expect(out).not.toMatch(/!/);
  });

  it('a signed report takes no more readings', () => {
    const words = text(html(<AverageTable s={study({ status: 'signed' })} m={machineStudy} defaultUse="average" onSaved={() => {}} onError={() => {}} />));
    expect(words).not.toContain('Fill the report');
    expect(words).toContain('The report is signed.');
  });

  it('pictures: the one already in the report says so; the others can be chosen', () => {
    const out = html(<MachinePictures s={study()} m={machineStudy} onSaved={() => {}} onError={() => {}} />);
    expect(text(out)).toContain('In the report');
    expect(out.match(/type="checkbox"/g)).toHaveLength(1);
    expect(out).toContain('aria-label="Picture 2 from the machine – loading"');
  });

  it('in the report: the readings, those not used struck through, the rule, the value, and a value changed by hand', () => {
    const machine = { fetus: 'A', rows: [{ key: 'bpd', name: 'BPD', unit: 'mm', readings: [78.1, 78.6, 77.9], ticked: [true, false, true], use: 'average', reading: 0, value: 78, edited: true }, { key: 'afi', name: 'AFI', unit: 'cm', readings: [], machine: 12.1, use: 'machine', reading: 0, value: 12.1, edited: false }] };
    const out = html(<MachineReadingsTable machine={machine} />);
    expect(text(out)).toContain('BPD (mm) 78.1 , 78.6 , 77.9 Average 78 (changed by hand)');
    expect(out).toContain('<s title="Not used">78.6</s>');
    expect(text(out)).toContain("AFI (cm) Machine: 12.1 Machine's own 12.1");
    expect(html(<MachineReadingsTable machine={null} />)).toBe('');
  });
});
