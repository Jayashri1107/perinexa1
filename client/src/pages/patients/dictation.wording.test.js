// Voice entry: dates, names and clinical wording as they are said (plan 4.1, groups G2–G5; all fake sample data).
import { describe, expect, it } from 'vitest';
import { answerToResult, checkRanges, extractPatientDetails, onlyLinkWords, prepareSpoken } from './dictation.js';

const now = new Date(2026, 8, 28, 11, 30); // 28 Sep 2026, 11:30
const voice = (text, careType = 'antenatal') => extractPatientDetails(text, { careType, now, words: [], voice: true });
const ticks = (r) => [...(r.values.medical?.conditions ?? []), ...(r.values.obstetric?.pastComplications ?? [])];
const asked = (r, rx) => r.questions.find((q) => rx.test(`${q.prompt} | ${q.heard} | ${q.options.map((o) => o.label).join(' | ')}`));

describe('dates (G2)', () => {
  it('reads a date said with spaces, "by" or no year right after LMP or EDD', () => {
    for (const [text, lmp] of [
      ['LMP 12 7 2026', '2026-07-12'],
      ['LMP twelve seven twenty twenty six', '2026-07-12'],
      ['LMP 10 by 7 by 2026', '2026-07-10'],
      ['LMP 12 by 7', '2026-07-12'],
      ['LMP 5/8', '2026-08-05'],
      ['LMP 30 6 26', '2026-06-30'],
      ['LMP 12 July twenty twenty six', '2026-07-12'],
      ['LMP 12 tarikh July', '2026-07-12'],
      ['LMP ka date 12 July', '2026-07-12'],
    ]) {
      expect(voice(text).values.pregnancy, text).toEqual({ lmp });
    }
    expect(voice('EDD by scan 23 12').values.pregnancy).toEqual({ scanEdd: '2026-12-23' });
    expect(voice('EDD by USG 15 3 2027').values.pregnancy).toEqual({ scanEdd: '2027-03-15' });
  });

  it('reads such a date only right after LMP, EDD, DOB or "born"', () => {
    expect(voice('scan on 12 7 2026').values.pregnancy).toBeUndefined();
    expect(voice('Hb 10 5 on 12 7').values.pregnancy).toBeUndefined();
    // the weeks said after the date are not its year
    const r = voice('LMP 12 7 28 weeks');
    expect(r.values.pregnancy?.lmp).toBe('2026-07-12');
  });

  it('knows other ways of saying the LMP', () => {
    for (const text of ['last MC 5th August', 'last menstrual cycle 5th August', 'last date 5th August', 'periods came on 5th August']) {
      expect(voice(text).values.pregnancy, text).toEqual({ lmp: '2026-08-05' });
    }
    expect(voice('last date not known').values.pregnancy).toBeUndefined();
  });

  it('a correction said while speaking works for these dates too', () => {
    const r = voice('LMP 12 7 sorry 13 7');
    expect(r.values.pregnancy).toEqual({ lmp: '2026-07-13' });
    expect(r.notes.join(' ')).toMatch(/Corrected while speaking: LMP 12 7 → 13 7/);
    expect(voice('last MC 5th August sorry 6th August').values.pregnancy).toEqual({ lmp: '2026-08-06' });
    // said twice with no "sorry": asked, never a silent pick
    const twice = voice('LMP 12 7 2026 G2 P1 LMP 14 7 2026');
    expect(twice.values.pregnancy).toBeUndefined();
    expect(asked(twice, /LMP was said twice: 12 Jul 2026 or 14 Jul 2026/)).toBeTruthy();
  });

  it('reads the time of birth however it is said', () => {
    for (const [text, at] of [
      ['born today at ten thirty am', '2026-09-28T10:30'],
      ['born today at 3 45 am', '2026-09-28T03:45'],
      ['born at 3 45 pm yesterday', '2026-09-27T15:45'],
      ['born today at ten thirty hours', '2026-09-28T10:30'],
      ['born today at 1030 hours', '2026-09-28T10:30'],
      ['born today morning 9 o\'clock', '2026-09-28T09:00'],
      ['born today at 4 in the morning', '2026-09-28T04:00'],
      ['born today subah 9 baje', '2026-09-28T09:00'],
      ['born yesterday shaam 7 baje', '2026-09-27T19:00'],
      ['born yesterday night at 11 20', '2026-09-27T23:20'],
      ['born today at 10 30', '2026-09-28T10:30'],
      ['born today at ten fifteen in the morning', '2026-09-28T10:15'],
      ['born today at quarter past nine', '2026-09-28T09:15'],
      ['born today at half past eight', '2026-09-28T08:30'],
      ['born today at quarter to ten', '2026-09-28T09:45'],
      ['time of birth 9 45 am', '2026-09-28T09:45'],
    ]) {
      expect(voice(`baby of Rekha ${text} weight 3 kg`, 'newborn').values.newborn, text).toEqual({ birthAt: at, birthWeightGrams: '3000' });
    }
  });

  it('reads a time of birth with the part of the day said next to it, and a 24-hour time after the date', () => {
    for (const [text, at] of [
      ['born yesterday 10 30 in the morning', '2026-09-27T10:30'],
      ['born 11 30 at night', '2026-09-27T23:30'],
      ['born last night 11 30', '2026-09-27T23:30'],
      ['born yesterday raat 11 30', '2026-09-27T23:30'],
      ['born 27 September 20 30 hours', '2026-09-27T20:30'],
      ['born September 27 20 30 hours', '2026-09-27T20:30'],
      ['born 27 9 20 30 hours', '2026-09-27T20:30'],
      ['DOB 26 September 20 45 hours', '2026-09-26T20:45'],
      ['born 27 September 10 30 am', '2026-09-27T10:30'],
      ['born 27 9 10 30 am', '2026-09-27T10:30'],
      ['born 27 September 1030 hours', '2026-09-27T10:30'],
      ['born 27th September 11:40 pm', '2026-09-27T23:40'],
    ]) {
      expect(voice(`baby of Rekha ${text} weight 3 kg`, 'newborn').values.newborn, text).toEqual({ birthAt: at, birthWeightGrams: '3000' });
    }
    // two-part and two-digit years still read
    expect(voice('LMP July 12 20 26').values.pregnancy).toEqual({ lmp: '2026-07-12' });
    expect(voice('LMP 5th August 12 weeks').values.pregnancy?.lmp).toBe('2026-08-05');
  });

  it('never takes a weight or a date as the time of birth, nor a time as the date', () => {
    expect(voice('baby of Rekha born 2 10 am weight 3 kg', 'newborn').values.newborn).toEqual({ birthAt: '2026-09-28T02:10', birthWeightGrams: '3000' });
    expect(voice('baby of Rekha born today at 2 kg 800 grams', 'newborn').values.newborn).toEqual({ birthWeightGrams: '2800' });
    expect(voice('baby of Rekha born today at 4 weight 3 kg', 'newborn').values.newborn).toEqual({ birthWeightGrams: '3000' }); // no morning or evening said
  });

  it('a part of the day said elsewhere, or "at 8 months", never sets the time of birth', () => {
    const at = (text) => voice(`baby of Rekha ${text} weight 3 kg`, 'newborn').values.newborn?.birthAt;
    expect(at('born at 11 15, in the evening mother had PPH')).toBe('2026-09-28T11:15');
    expect(at('born yesterday at 9 15, cried immediately, mother had fever at night')).toBe('2026-09-27T09:15');
    expect(at('delivered at 8 months this morning')).toBeUndefined();
    expect(at('born at 7 months, cried at night')).toBeUndefined();
    expect(at('born this morning, apgar 8 at 1 minute 9 at 5 minutes')).toBeUndefined();
    expect(at('born this morning apgar 7 10')).toBeUndefined();
    // the time is never the digits of the date
    const r = voice('baby of Rekha DOB 20 09 night weight 3 kg', 'newborn');
    expect(r.values.newborn).toEqual({ birthWeightGrams: '3000' });
    expect(r.notes.join(' ')).toMatch(/time of birth was not recognised/);
  });

  it('a newborn’s date of birth said straight after "born on" or "DOB"', () => {
    expect(voice('baby of rekha born on 25 9 2026 at 10 pm weight 3 kg', 'newborn').values.newborn).toEqual({ birthAt: '2026-09-25T22:00', birthWeightGrams: '3000' });
    const r = voice('baby of priya DOB 26th September TOB 2:30 pm BW 2.6 kg', 'newborn');
    expect(r.values).toMatchObject({ fullName: 'Baby of Priya', newborn: { birthAt: '2026-09-26T14:30', birthWeightGrams: '2600' } });
  });

  it('a newborn’s date of birth said after the time is never replaced by today', () => {
    for (const [text, at] of [
      ['time of birth 10 30, date of birth 25 9 2026', '2026-09-25T10:30'],
      ['baby born at 10 30 on 25 9 2026', '2026-09-25T10:30'],
      ['tob 10 30 am, dob 25 9 2026', '2026-09-25T10:30'],
      ['TOB 10 20 hours DOB 25 9', '2026-09-25T10:20'],
      ['born at 10 30 on 27 9', '2026-09-27T10:30'],
      ['born at 9 15 pm dated 25 9', '2026-09-25T21:15'],
      ['delivered on 25 9 at 10 30 am', '2026-09-25T10:30'],
    ]) {
      expect(voice(`baby of Rekha ${text} weight 3 kg`, 'newborn').values.newborn, text).toEqual({ birthAt: at, birthWeightGrams: '3000' });
    }
    // a date of birth that cannot be read is never replaced by today
    for (const text of ['tob 10 30 am dob 31 9 2026', 'time of birth 10 30 am date of birth not known', 'born at 10 30 am on 31 9 2026']) {
      const r = voice(`baby of Rekha ${text} weight 3 kg`, 'newborn');
      expect(r.values.newborn?.birthAt, text).toBeUndefined();
      expect(r.notes.join(' '), text).toMatch(/date of birth was not recognised/);
    }
    expect(voice('baby of Rekha born on the way at 10 30 am', 'newborn').values.newborn).toEqual({ birthAt: '2026-09-28T10:30' });
    expect(voice('baby of Rekha born at 10 30 on oxytocin', 'newborn').values.newborn).toEqual({ birthAt: '2026-09-28T10:30' });
  });
});

describe('names and addresses (G3)', () => {
  it('a name ends only where the next detail starts', () => {
    expect(voice('name bharati para age 28').values).toMatchObject({ fullName: 'Bharati Para', ageYears: '28' });
    expect(voice('name nergis doctor age 28').values).toMatchObject({ fullName: 'Nergis Doctor', ageYears: '28' });
    expect(voice('name Asha Patil para 2 living 2').values).toMatchObject({ fullName: 'Asha Patil', obstetric: { para: '2', living: '2' } });
    expect(voice('name Asha referred by Dr Kulkarni').values.fullName).toBe('Asha');
    expect(voice('name Asha mother diabetic').values.fullName).toBe('Asha');
  });

  it('fillers and "umar" before an age are not part of a name', () => {
    expect(voice('name haan sunita devi age 28').values.fullName).toBe('Sunita Devi');
    expect(voice('name priya achha age 28').values.fullName).toBe('Priya');
    expect(voice('name, uh, sunita devi age 28').values.fullName).toBe('Sunita Devi');
    expect(voice('name kavita patil umar 28 saal', 'gynaecology').values).toMatchObject({ fullName: 'Kavita Patil', ageYears: '28' });
    expect(voice('name kavita patil umar tees saal', 'gynaecology').values.fullName).toBe('Kavita Patil');
  });

  it('her name after the husband’s name', () => {
    expect(voice('husband name ramesh kumar patient name sunita devi age 28').values).toMatchObject({ fullName: 'Sunita Devi', ageYears: '28' });
  });

  it('a newborn’s mother: "time of birth", DOB, TOB and BW end her name, and "baby of mother" is read', () => {
    expect(voice('baby of rekha time of birth 9 45 am weight 3 kg', 'newborn').values.fullName).toBe('Baby of Rekha');
    const r = voice('baby of mother anjali gupta born today at 8:20 am weight 3 kg', 'newborn');
    expect(r.values).toMatchObject({ fullName: 'Baby of Anjali Gupta', motherName: 'Anjali Gupta' });
  });

  it('an address keeps words that start a detail only when said with it ("Blood Bank", "Old Age Home", "Dr Ambedkar")', () => {
    for (const [text, address] of [
      ['address near Dr Ambedkar chowk nagpur phone 98765 43210', 'Near Dr Ambedkar Chowk Nagpur'],
      ['address near doctor ambedkar chowk nagpur phone 98765 43210', 'Near Doctor Ambedkar Chowk Nagpur'],
      ['address ghosh para kolkata phone 98765 43210', 'Ghosh Para Kolkata'],
      ['address opposite blood bank civil lines jaipur', 'Opposite Blood Bank Civil Lines Jaipur'],
      ['address old age home road kochi', 'Old Age Home Road Kochi'],
      ['address near sai scan centre aundh pune', 'Near Sai Scan Centre Aundh Pune'],
      ['address mother dairy road patparganj delhi', 'Mother Dairy Road Patparganj Delhi'],
      ['address MES married quarters pune cantonment', 'MES Married Quarters Pune Cantonment'],
    ]) {
      expect(voice(text, 'gynaecology').values.address, text).toBe(address);
    }
  });

  it('an address ends at the next detail, a filler or "thank you"', () => {
    expect(voice('address mohammed ali road mumbai postnatal delivered on 20th September', 'postnatal').values.address).toBe('Mohammed Ali Road Mumbai');
    expect(voice('address baner pune last MC 12th july').values).toMatchObject({ address: 'Baner Pune', pregnancy: { lmp: '2026-07-12' } });
    expect(voice('address kothrud pune thank you').values.address).toBe('Kothrud Pune');
    expect(voice('address kothrud pune ji').values.address).toBe('Kothrud Pune');
    expect(voice('address haan wakad pune achha phone 98765 43210').values.address).toBe('Wakad Pune');
    expect(voice('address Asha Nagar para 2 living 2').values).toMatchObject({ address: 'Asha Nagar', obstetric: { para: '2', living: '2' } });
    expect(voice('address Baner Pune age 28').values).toMatchObject({ address: 'Baner Pune', ageYears: '28' });
  });

  it('other ways of saying where she lives', () => {
    expect(voice('village khed taluka rajgurunagar district pune phone 98765 43210').values.address).toBe('Village Khed Taluka Rajgurunagar District Pune');
    expect(voice('residence at wakad pune phone 98765 43210').values.address).toBe('Wakad Pune');
    expect(voice('at post khed district pune').values.address).toBe('Khed District Pune');
  });

  it('"village" or "gaon" starts an address only when no address word is said and a place name follows', () => {
    expect(voice('referred by village health nurse, address Wakad Pune').values.address).toBe('Wakad Pune');
    expect(voice('gaon se aayi hai, address Khed').values.address).toBe('Khed');
    expect(voice('from village side, address 12 Palm Tree Colony').values.address).toBe('12 Palm Tree Colony');
    expect(voice('village se referred, G2 P1').values.address).toBeUndefined();
    expect(voice('village health worker referred her, G2 P1').values.address).toBeUndefined();
    expect(voice('gaon Shirur district Pune').values.address).toBe('Gaon Shirur District Pune');
  });

  it('a finding said right after the address ends it and is still read', () => {
    let r = voice('address wakad pune scan shows placenta previa');
    expect(r.values.address).toBe('Wakad Pune');
    expect(r.values.notes).toMatch(/placenta praevia/i);
    for (const text of ['address wakad pune known hypothyroid on thyronorm', 'address wakad pune. known hypothyroid']) {
      r = voice(text);
      expect(r.values.address, text).toBe('Wakad Pune');
      expect(ticks(r), text).toContain('thyroid');
    }
    r = voice('address wakad pune hyperemesis');
    expect(r.values).toMatchObject({ address: 'Wakad Pune', notes: expect.stringMatching(/hyperemesis/i) });
    r = voice('address 12 MG road, mother is diabetic');
    expect(r.values.address).toBe('12 MG Road');
    expect(ticks(r)).not.toContain('diabetes');
    r = voice('address wakad pune blood pressure high');
    expect(r.values.address).toBe('Wakad Pune');
    expect(r.unused.map((u) => u.text).join(' ')).toContain('blood pressure high');
    // a place named after a finding stays whole
    r = voice('address near TB hospital road nagpur');
    expect(r.values.address).toBe('Near TB Hospital Road Nagpur');
    expect(ticks(r)).toEqual([]);
  });

  it('an LMP said after the address, and corrected, is never taken into the address', () => {
    for (const label of ['last MC', 'last date', 'periods came on']) {
      const r = voice(`name Asha Sample address Wakad Pune ${label} 5th July sorry 6th July`);
      expect(r.values, label).toMatchObject({ address: 'Wakad Pune', pregnancy: { lmp: '2026-07-06' } });
      expect(r.notes, label).toContain('Corrected while speaking: LMP 5th July → 6th July.');
    }
  });

  it('joins a pincode or flat number said digit by digit, but never takes in a phone number', () => {
    expect(voice('address sector 15 rohini delhi pin code 1 1 0 0 8 5 phone 98765 43210').values.address).toBe('Sector 15 Rohini Delhi Pin Code 110085');
    expect(voice('address flat number two zero three sai heights baner').values.address).toBe('Flat Number 203 Sai Heights Baner');
    const r = voice('address baner pune 9 8 7 6 5 4 3 2 1 0');
    expect(r.values).toMatchObject({ address: 'Baner Pune', phone: '98765 43210' });
    expect(voice('address baner pune 0 9 8 7 6 5 4 3 2 1 0').values).toMatchObject({ address: 'Baner Pune', phone: '98765 43210' });
    // a pincode and a phone both said digit by digit: split only after a whole pincode
    for (const text of ['address flat 2 0 3 Wakad Pune 4 1 1 0 5 7 9 8 7 6 5 4 3 2 1 0', 'address flat two zero three Wakad Pune four one one zero five seven nine eight seven six five four three two one zero']) {
      expect(voice(text).values, text).toMatchObject({ address: 'Flat 203 Wakad Pune 411057', phone: '98765 43210' });
    }
    const unsure = voice('address Wakad Pune 4 1 1 0 5 7 9 8 7 6 5 4 3 2 1');
    expect(unsure.values.phone).toBeUndefined();
    expect(unsure.values.address).toBe('Wakad Pune 4 1 1 0 5 7 9 8 7 6 5 4 3 2 1');
    expect(unsure.notes).toContain('Phone heard with 15 digits – check it and type it in.');
    expect(voice('7 9 8 7 6 5 4 3 2 1 0').values.phone).toBeUndefined();
    // other runs of digits are left as heard, never joined into one clean-looking number
    expect(voice('address flat 2 0 3 4 1 1 0 5 7').values.address).toBe('Flat 2 0 3 4 1 1 0 5 7');
    expect(voice('address baner pune 9 8 7 6 5 4 3 2 1').values).toEqual({ address: 'Baner Pune 9 8 7 6 5 4 3 2 1' });
    expect(voice('address flat 4 0 2 baner pune 4 1 1 0 4 5 9 8 7 6 5 4 3 2 1').values.address).toBe('Flat 402 Baner Pune 4 1 1 0 4 5 9 8 7 6 5 4 3 2 1');
  });
});

describe('the obstetric formula and caesareans (G4)', () => {
  it('reads "to", "for", "ji", "plus", "nil" and "O" inside the formula', () => {
    for (const [text, ob] of [
      ['G to P1 L1 A0', { gravida: '2', para: '1', living: '1', abortions: '0' }],
      ['G for P3 L3 A0', { gravida: '4', para: '3', living: '3', abortions: '0' }],
      ['gravida to para one living one abortion zero', { gravida: '2', para: '1', living: '1', abortions: '0' }],
      ['ji 2 P1 L1 A0', { gravida: '2', para: '1', living: '1', abortions: '0' }],
      ['G3 P 1 plus 1 L1', { gravida: '3', para: '1', living: '1', abortions: '1' }],
      ['G2 P1 L1 A nil', { gravida: '2', para: '1', living: '1', abortions: '0' }],
      ['G2 P1 L1 AO', { gravida: '2', para: '1', living: '1', abortions: '0' }],
      ['P1 L1 A none', { para: '1', living: '1', abortions: '0' }],
    ]) {
      expect(voice(text).values.obstetric, text).toEqual(ob);
    }
    expect(voice('para to living to').values.obstetric).toEqual({ para: '2', living: '2' });
  });

  it('leaves "to", "for" and "ji" alone outside the formula', () => {
    expect(voice('Patil ji 28').values.obstetric).toBeUndefined();
    expect(voice('living for 2 years in Pune').values.obstetric).toBeUndefined();
    expect(voice('G2 P1 L1 A0 on insulin for GDM').values.obstetric).toEqual({ gravida: '2', para: '1', living: '1', abortions: '0' });
    expect(voice('referred to para medical staff').values.obstetric).toBeUndefined();
    expect(voice('she has vitamin A to D3 deficiency').unused.map((u) => u.text).join(' ')).toContain('A to D3');
    expect(voice('plan a for D1 review').unused.map((u) => u.text).join(' ')).toContain('a for D1');
    expect(voice('G2 P to L1 A0').values.obstetric).toEqual({ gravida: '2', para: '2', living: '1', abortions: '0' });
  });

  it('a describing word before "abortions"', () => {
    expect(voice('h/o 2 missed abortions G3 P0 L0').values.obstetric).toEqual({ gravida: '3', para: '0', living: '0', abortions: '2' });
    expect(voice('2 spontaneous miscarriages').values.obstetric).toEqual({ abortions: '2' });
  });

  it('a previous caesarean however it is said', () => {
    for (const text of [
      'previous CS',
      'previous else CS',
      'previous Elsie s',
      'previous L SCS',
      'previous LCS',
      'previous sizerian',
      'previous sezarian 2021',
      'previous see section',
      'previous season section',
      'precious LSCS',
      '1st delivery was by LSCS',
      'last pregnancy LSCS',
      'pehli delivery LSCS thi',
    ]) {
      expect(voice(text).values.obstetric, text).toEqual({ previousCaesareans: '1' });
    }
    expect(voice('previous LSCS twice').values.obstetric).toEqual({ previousCaesareans: '2' });
    expect(voice('twice LSCS').values.obstetric).toEqual({ previousCaesareans: '2' });
  });

  it('a caesarean planned for this pregnancy, or this delivery’s care, is not a previous one', () => {
    for (const text of ['primi, breech, planned for a CS at 39 weeks', 'primi, post CS counselling']) {
      expect(voice(text).values.obstetric?.previousCaesareans, text).toBe('0');
    }
    for (const text of ['G1, breech, counselled, needs a CS', 'G1 32 weeks, may need a CS', 'breech so a CS is advised', 'G1, has a scar on abdomen from appendix']) {
      expect(voice(text).values.obstetric?.previousCaesareans, text).toBeUndefined();
    }
    expect(voice('post CS day 2', 'postnatal').values.obstetric?.previousCaesareans).toBeUndefined();
    expect(voice('G2 P1 L1 A0, needs a CS').values.obstetric).toEqual({ gravida: '2', para: '1', living: '1', abortions: '0' });
    for (const text of ['a previous LSCS', 'an earlier caesarean', 'post LSCS', 'status post LSCS']) {
      expect(voice(text).values.obstetric, text).toEqual({ previousCaesareans: '1' });
    }
    // more previous caesareans than deliveries is never filled
    const r = voice('primi, previous LSCS');
    expect(r.values.obstetric.previousCaesareans).toBeUndefined();
    expect(r.notes.join(' ')).toMatch(/para is 0/);
    expect(checkRanges({ obstetric: { para: '1', previousCaesareans: '2' } }, {}, 'antenatal').drop).toContain('obstetric.previousCaesareans');
  });

  it('caesareans said delivery by delivery are asked about when more than one, or in postnatal care', () => {
    const count = (q, n) => q.options.some((o) => o.value === `value:obstetric.previousCaesareans=${n}`);
    for (const text of ['G3 P2 L2, 1st delivery LSCS, 2nd delivery also LSCS', 'G4 P3 L3, 1st delivery LSCS, 2nd normal, 3rd delivery LSCS', '1st delivery LSCS 2nd delivery LSCS', 'G3 P2 L2 A0 1st and 2nd delivery LSCS', 'previous LSCS, 2nd delivery also LSCS']) {
      const r = voice(text);
      expect(r.values.obstetric?.previousCaesareans, text).toBeUndefined();
      const q = asked(r, /how many previous caesareans/);
      expect(q, text).toMatchObject({ group: 'safety' });
      expect(count(q, 2), text).toBe(true);
      expect(answerToResult(q, 'value:obstetric.previousCaesareans=2', 'antenatal').values.obstetric).toEqual({ previousCaesareans: '2' });
    }
    expect(voice('1st delivery LSCS 2nd delivery normal').values.obstetric).toEqual({ previousCaesareans: '1' });
    for (const text of ['primi, 1st delivery by LSCS on 26 9 2026', 'G1 P1 L1, 1st delivery by LSCS on 26 9 2026', 'last delivery LSCS']) {
      const r = voice(text, 'postnatal');
      expect(r.values.obstetric?.previousCaesareans, text).toBeUndefined();
      expect(count(asked(r, /how many caesareans before this delivery/), 0), text).toBe(true);
    }
    const post = voice('previous LSCS, delivered by LSCS today', 'postnatal');
    expect(post.values).toMatchObject({ obstetric: { previousCaesareans: '1' }, notes: 'Delivered by caesarean section' });
  });

  it('"previous Syrian" is asked about, never filled; "previous seizure" is not a caesarean', () => {
    const r = voice('previous Syrian');
    expect(r.values.obstetric).toBeUndefined();
    const q = asked(r, /A previous caesarean/);
    expect(q).toMatchObject({ group: 'safety' });
    expect(answerToResult(q, q.options[0].value, 'antenatal').values.obstetric).toEqual({ previousCaesareans: '1' });
    expect(voice('previous seizure').values.obstetric).toBeUndefined();
    expect(voice('season section').values.obstetric).toBeUndefined();
    expect(voice('see section 3 of the report').values.obstetric).toBeUndefined();
    const post = voice('delivered by Syrian today', 'postnatal');
    expect(post.values.notes).toBeUndefined();
    expect(asked(post, /Delivered by caesarean/)).toBeTruthy();
  });

  it('"G2 P1 L1 A0 CS" is asked about like "LSCS"', () => {
    const r = voice('G2 P1 L1 A0 CS');
    expect(r.values.obstetric.previousCaesareans).toBeUndefined();
    expect(asked(r, /previous caesarean/)).toBeTruthy();
  });
});

describe('clinical wording and questions (G5)', () => {
  it('"BP high", "BP is high", "BP ki problem" are asked about', () => {
    for (const text of ['BP high', 'BP is high', 'BP ki problem hai']) {
      const r = voice(text);
      expect(ticks(r), text).toEqual([]);
      expect(asked(r, /High blood pressure/), text).toBeTruthy();
    }
    expect(asked(voice('BP high', 'gynaecology'), /High blood pressure \(hypertension\)\?/)).toBeTruthy();
    expect(asked(voice('BP normal'), /High blood pressure/)).toBeFalsy();
  });

  it('high BP said about a previous pregnancy is asked as previous PIH', () => {
    for (const text of ['BP was high in last pregnancy', 'high BP in her previous pregnancy', 'previous pregnancy BP was high']) {
      const r = voice(text);
      expect(ticks(r), text).toEqual([]);
      expect(asked(r, /In a previous pregnancy – was it pre-eclampsia\?/), text).toBeTruthy();
      expect(asked(r, /before this pregnancy, or of this pregnancy/), text).toBeFalsy();
    }
    // "before pregnancy" is high BP from before this pregnancy, not a previous pregnancy
    expect(asked(voice('high BP before pregnancy'), /before this pregnancy, or of this pregnancy/)).toBeTruthy();
    expect(asked(voice('previous LSCS, BP high'), /before this pregnancy, or of this pregnancy/)).toBeTruthy();
    expect(asked(voice('BP was high in last pregnancy', 'gynaecology'), /In a previous pregnancy/)).toBeTruthy();
  });

  it('"past history nil", "nil significant" and "no other illness" mean no known conditions', () => {
    for (const text of ['past history nil', 'medical history nil', 'past medical history is not significant', 'nil significant', 'no other illness']) {
      expect(voice(text).values.medical, text).toEqual({ conditionsReviewed: true });
    }
    expect(voice('allergic to sulpha no other illness').values.medical).toEqual({ allergies: 'Sulpha', conditionsReviewed: true });
  });

  it('"nil significant" after family, surgical or other histories is not "no known conditions"', () => {
    for (const text of ['family history nil significant', 'surgical history nil significant', 'past surgical history nothing significant', 'obstetric history nil significant', 'menstrual history nil significant', 'family medical history nil', 'family history no chronic illness']) {
      expect(voice(text).values.medical?.conditionsReviewed, text).toBeUndefined();
    }
    expect(voice('family history of diabetes, past history nil significant').values.medical).toEqual({ conditionsReviewed: true });
    const r = voice('past medical history - nothing significant');
    expect(r.values.medical).toEqual({ conditionsReviewed: true });
    expect(r.unused).toEqual([]);
  });

  it('"hypo" and "MS" are not asked about when the finding is already ticked', () => {
    expect(voice('hypothyroid on eltroxin hypo').questions).toEqual([]);
    expect(ticks(voice('RHD with severe MS'))).toEqual(['heart_disease']);
    expect(asked(voice('RHD with severe MS'), /Mitral stenosis/)).toBeFalsy();
    expect(asked(voice('known case of MS'), /Mitral stenosis/)).toBeTruthy();
    expect(asked(voice('hypo'), /Hypothyroidism/)).toBeTruthy();
  });

  it('no "did you mean" about a finding already ticked', () => {
    const r = voice('asthma on inhaler asthama');
    expect(ticks(r)).toEqual(['asthma']);
    expect(asked(r, /Did you mean/)).toBeFalsy();
  });

  it('a blood group subgroup (A1, A1B) is its ABO group', () => {
    expect(asked(voice('blood group A1 positive'), /^Blood group A\+ – is that right/)).toBeTruthy();
    expect(asked(voice('blood group A1B positive'), /^Blood group AB\+ – is that right/)).toBeTruthy();
    expect(asked(voice('blood group a b positive'), /^Blood group AB\+ – is that right/)).toBeTruthy();
    expect(extractPatientDetails('blood group A2 negative', { careType: 'antenatal', now }).values.medical.bloodGroup).toBe('A-');
    // "A1" in the formula is not a blood group
    expect(voice('G2 P1 L0 A1 positive for anomaly').values.obstetric).toMatchObject({ abortions: '1' });
  });

  it('GDM or abruption in a previous pregnancy is an other condition, not a note about this one', () => {
    for (const [text, other] of [
      ['previous GDM', 'Previous pregnancy – Gestational diabetes'],
      ['previous pregnancy GDM', 'Previous pregnancy – Gestational diabetes'],
      ['GDM in the last pregnancy', 'Previous pregnancy – Gestational diabetes'],
      ['previous abruption', 'Previous pregnancy – Antepartum haemorrhage / abruption'],
    ]) {
      const r = voice(text);
      expect(r.values.medical?.otherConditions, text).toBe(other);
      expect(r.values.notes, text).toBeUndefined();
    }
    expect(voice('GDM on diet').values.notes).toMatch(/Gestational diabetes \(this pregnancy\)/);
    expect(voice('h/o leaking PV since morning').values.medical?.otherConditions).toBeUndefined();
    // said about this pregnancy too: asked, never dropped
    for (const text of ['GDM in the previous pregnancy and also this pregnancy', 'GDM in the previous pregnancy and also this pregnancy on metformin', 'GDM in the previous pregnancy and now also']) {
      const r = voice(text);
      expect(r.values.medical?.otherConditions, text).toBe('Previous pregnancy – Gestational diabetes');
      expect(asked(r, /^Gestational diabetes in this pregnancy too\?/), text).toBeTruthy();
    }
    expect(voice('previous GDM').questions).toEqual([]);
    const both = voice('previous GDM, now also GDM on metformin');
    expect(both.values).toMatchObject({ medical: { otherConditions: 'Previous pregnancy – Gestational diabetes' }, notes: expect.stringMatching(/Gestational diabetes \(this pregnancy\)/) });
    expect(asked(both, /in this pregnancy too/)).toBeFalsy();
  });

  it('"today" is this delivery', () => {
    const r = voice('G2 P1 L1 A0 previous LSCS delivered by LSCS today PPH', 'postnatal');
    expect(ticks(r)).toEqual([]);
    expect(r.values.notes).toMatch(/Delivered by caesarean/);
    expect(r.values.notes).toMatch(/PPH/);
  });

  it('"preterm" alone is a preterm birth', () => {
    expect(ticks(voice('previous preterm at 34 weeks'))).toEqual(['preterm_birth']);
    expect(ticks(voice('G2 P1 L1 A0 previous baby pre term'))).toEqual(['preterm_birth']);
  });

  it('lists the words not understood, also next to words that were', () => {
    const r = voice('age 28 likes gardening a lot, G2 P1 L1 A0');
    expect(r.unused.map((u) => u.text)).toEqual(['likes gardening a lot']);
    expect(voice('Thyronorm 50 mcg daily tab').unused).toEqual([]);
    // short forms and readings with nothing filled from them are listed
    expect(voice('age 28, TSH FSH').unused.map((u) => u.text)).toEqual(['TSH FSH']);
    expect(voice('TSH FSH').unused.map((u) => u.text)).toEqual(['TSH FSH']);
    expect(voice('age 28, BP 140 by 90').unused.map((u) => u.text)).toEqual(['BP 140 by 90']);
    // the baby's sex is never offered for the notes, and outside a pregnancy not listed at all
    expect(voice('age 28 baby is a boy as per scan').unused).toMatchObject([{ canNote: false, sex: true }]);
    expect(voice('age 28 baby is a boy as per scan', 'gynaecology').unused).toEqual([]);
  });

  it('never lists a result, a "no" or a clinical word said with a finding that was read', () => {
    for (const text of [
      'HIV non reactive VDRL non reactive',
      'HIV, HBsAg and VDRL negative',
      'HIV test report non reactive',
      'known case of diabetes mellitus',
      'k/c/o asthma',
      'h/o TB',
      'not a known case of DM HTN thyroid',
      'no history of diabetes hypertension asthma',
      'family history of diabetes',
      'G2 P1 L1 A0 HIV non reactive HBsAg negative no DM no HTN previous LSCS',
      'no DM HTN thyroid asthma', // the later words are asked about, the "no" is used
    ]) {
      expect(voice(text).unused, text).toEqual([]);
    }
    // the label of a weight read with it
    expect(voice('baby of Anita Sample born today at 8:20 am birth weight 2 kilo 800', 'newborn').unused).toEqual([]);
    expect(voice('G2 P1 L1 A0 weight 60 kg').unused).toEqual([]);
    expect(voice('name Kavita Sample 32 years of age').unused).toEqual([]);
    // a husband's name has no field, so it is still listed
    expect(voice('husband name Ramesh Sample, age 28').unused.map((u) => u.text)).toEqual(['husband name Ramesh Sample']);
  });

  it('lists a number left over, and asks about "she is 32" as the age', () => {
    const r = voice("name Kavita Sample she's thirty two phone 98765 43210", 'gynaecology');
    expect(r.values.ageYears).toBeUndefined();
    expect(asked(r, /^Age 32\?/)).toMatchObject({ part: 'info', options: [{ value: 'value:ageYears=32' }, { value: 'ignore' }] });
    expect(r.unused).toEqual([]);
    expect(voice('she is 32 weeks pregnant').questions.filter((q) => /^Age/.test(q.prompt))).toEqual([]);
    expect(voice('Kavita Sample 32, phone 98765 43210', 'gynaecology').unused.map((u) => u.text)).toEqual(['Kavita Sample 32']);
    expect(voice('Thyronorm 50 mcg daily').unused).toEqual([]); // a dose goes with its medicine
  });

  it('gives each part listed where it was said, and never offers a result or a "no" alone for the notes', () => {
    const r = voice('likes gardening, likes gardening');
    expect(r.unused.map((u) => u.text)).toEqual(['likes gardening', 'likes gardening']);
    expect(r.unused[1].start).toBeGreaterThan(r.unused[0].start); // so the screen can tell the two apart
    for (const text of ['non reactive', 'not a known case of', 'known case of', 'history of', 'negative', 'no h/o']) expect(onlyLinkWords(text), text).toBe(true);
    for (const text of ['husband name Ramesh', 'likes gardening', 'birth weight', 'on diet']) expect(onlyLinkWords(text), text).toBe(false);
  });
});

describe('prepareSpoken (text prepared for other readers, e.g. visit notes)', () => {
  it('prepares spoken text the same way as the new-patient reader', () => {
    const r = prepareSpoken('weight fifty fife kg sorry fifty six kg, previous sizerian, haan ji', { careType: 'antenatal' });
    expect(r.text).toMatch(/weight 56 kg, previous caesarean/);
    expect(r.text).not.toMatch(/haan|fife|sizerian/);
    expect(r.corrections.map((c) => c.to)).toEqual(expect.arrayContaining(['five', 'caesarean']));
    expect(r.selfCorrections).toHaveLength(1);
  });

  it('leaves names and addresses as said and never lists the baby\'s sex', () => {
    const r = prepareSpoken('address 12 palm tree colony wakad, baby is a boy as per scan', { careType: 'antenatal' });
    expect(r.text).toMatch(/12 palm tree colony/);
    expect(r.spans.some((x) => x.kind === 'address')).toBe(true);
    expect(JSON.stringify(r.corrections)).not.toMatch(/boy/i);
  });

  it('keeps a word left as heard (Undo)', () => {
    const r = prepareSpoken('previous sizerian', { careType: 'antenatal', keep: ['sizerian'] });
    expect(r.text).toMatch(/sizerian/);
    expect(r.corrections).toHaveLength(0);
  });
});
