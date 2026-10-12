// Voice entry: each person's own remembered words ("My account → Voice words").
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb } from './helpers.js';

const app = createApp();
let doctor;
let other;

beforeAll(connectTestDb);
beforeEach(async () => {
  await resetTestDb();
  const home = await createTenant('Home Hospital');
  doctor = await createUser({ name: 'Dr. Words' });
  other = await createUser({ name: 'Dr. Other' });
  await addMember(doctor, home, 'doctor');
  await addMember(other, home, 'doctor');
});
afterAll(disconnectTestDb);

describe('voice words', () => {
  it('needs a login', async () => {
    expect((await request(app).get('/api/me/dictation-words')).status).toBe(401);
  });

  it('adds, changes, lists and removes your own words', async () => {
    const s = await loginAs(doctor, { app });
    const added = await s.put('/api/me/dictation-words').send({ phrase: '  Asma ', meaning: 'condition:asthma' });
    expect(added.status).toBe(200);
    expect(added.body.word).toMatchObject({ phrase: 'asma', meaning: 'condition:asthma' });
    expect(added.body.word.userId).toBeUndefined();

    await s.put('/api/me/dictation-words').send({ phrase: 'PCOD', meaning: 'other:PCOS' });
    const changed = await s.put('/api/me/dictation-words').send({ phrase: 'asma', meaning: 'ignore' });
    expect(changed.body.word.id).toBe(added.body.word.id);

    const list = await s.get('/api/me/dictation-words');
    expect(list.body.words.map((w) => [w.phrase, w.meaning])).toEqual([
      ['asma', 'ignore'],
      ['pcod', 'other:PCOS'],
    ]);

    expect((await s.delete(`/api/me/dictation-words/${added.body.word.id}`)).status).toBe(204);
    expect((await s.get('/api/me/dictation-words')).body.words).toHaveLength(1);
  });

  it("keeps each person's words to themselves", async () => {
    const mine = await loginAs(doctor, { app });
    const word = (await mine.put('/api/me/dictation-words').send({ phrase: 'hypo', meaning: 'condition:thyroid' })).body.word;
    const theirs = await loginAs(other, { app });
    expect((await theirs.get('/api/me/dictation-words')).body.words).toEqual([]);
    expect((await theirs.delete(`/api/me/dictation-words/${word.id}`)).status).toBe(404);
    expect((await mine.get('/api/me/dictation-words')).body.words).toHaveLength(1);
  });

  it('only accepts a short word and one of the known meanings', async () => {
    const s = await loginAs(doctor, { app });
    const bad = [
      { phrase: 'asma', meaning: 'condition:not_a_condition' },
      { phrase: 'asma', meaning: 'notes:anything at all' },
      { phrase: 'asma', meaning: 'other:<script>' },
      { phrase: 'one two three four five', meaning: 'ignore' },
      { phrase: 'x'.repeat(41), meaning: 'ignore' },
      { phrase: 'phone: 98765', meaning: 'ignore' },
      { phrase: '', meaning: 'ignore' },
      { phrase: 'baby boy', meaning: 'note:BOY' },
      // PCPNDT: a karyotype phrase (lower-cased on the way in), and a note about the baby's sex
      { phrase: 'xy', meaning: 'ignore' },
      { phrase: 'XX', meaning: 'ignore' },
      { phrase: 'asma', meaning: 'note:Baby boy' },
    ];
    for (const body of bad) expect([body, (await s.put('/api/me/dictation-words').send(body)).status]).toEqual([body, 400]);
    expect((await s.get('/api/me/dictation-words')).body.words).toEqual([]);
  });

  it('never keeps a word that could change a result or a "no", a number, or a patient value', async () => {
    const s = await loginAs(doctor, { app });
    const bad = [
      ...['no', 'not', 'non', 'none', 'nil', 'known', 'on', 'positive', 'negative', 'reactive', 'sorry'].map((phrase) => ({ phrase, meaning: 'ignore' })),
      { phrase: 'Known', meaning: 'ignore' }, // capitals don't matter
      { phrase: 'non reactive', meaning: 'ignore' },
      { phrase: 'hiv positive', meaning: 'condition:hiv' },
      { phrase: 'no sorry', meaning: 'ignore' },
      { phrase: 'para 2', meaning: 'ignore' },
      { phrase: 'g2', meaning: 'ignore' },
      // punctuation the phrase rule allows does not get round the list
      { phrase: 'no.', meaning: 'ignore' },
      { phrase: 'known.', meaning: 'ignore' },
      { phrase: 'no/nil', meaning: 'ignore' },
      { phrase: 'non/reactive', meaning: 'ignore' },
      { phrase: "non'reactive", meaning: 'ignore' },
      { phrase: 'asma', meaning: 'value:ageYears=28' },
      { phrase: 'asma', meaning: 'value:pregnancy.lmp=2026-07-05' },
    ];
    for (const body of bad) expect([body, (await s.put('/api/me/dictation-words').send(body)).status]).toEqual([body, 400]);
    expect((await s.get('/api/me/dictation-words')).body.words).toEqual([]);
    // words that only contain these letters are fine
    expect((await s.put('/api/me/dictation-words').send({ phrase: 'nonie', meaning: 'ignore' })).status).toBe(200);
    expect((await s.put('/api/me/dictation-words').send({ phrase: 'ontario', meaning: 'ignore' })).status).toBe(200);
  });

  it('keeps a built-in meaning that only mentions the partner (not the baby)', async () => {
    const s = await loginAs(doctor, { app });
    const res = await s.put('/api/me/dictation-words').send({ phrase: 'oligospermea', meaning: 'other:Male factor infertility' });
    expect(res.status).toBe(200);
    expect(res.body.word).toMatchObject({ phrase: 'oligospermea', meaning: 'other:Male factor infertility' });
  });
});
