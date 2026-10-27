import { Info } from 'lucide-react';

// Counselling numbers on the Treatment plan tab (fertility idea F3, the owner's go-ahead of 27 Oct 2026): the chance
// per cycle of each step, as POPULATION figures – never a prediction for her. Only figures with a source:
//  - ovulation induction and IUI: the counselling lines of the fertility protocol library the owner approved on
//    27 Oct 2026 (server/src/fertility/protocols.js – follicular_study, oi_letrozole, iui);
//  - IVF: HFEA, Fertility treatment 2024: trends and figures (preliminary, not yet validated) – birth rate per embryo
//    transferred, own eggs, fresh and frozen together. HFEA publishes no figure for the other age bands on that page,
//    so none is shown. Indian ART Registry figures can replace these when the owner chooses.

export const COUNSELLING_ROWS = [
  { step: 'Follicular study with timed intercourse', chance: 'About 10–20 % per cycle', when: 'when she ovulates and the semen and tubes are normal', source: 'Approved protocol library (follicular study)' },
  { step: 'Ovulation induction (letrozole or clomiphene)', chance: 'Roughly 15–25 % per ovulatory cycle', when: 'twins about 5–8 % with clomiphene, lower with letrozole', source: 'Approved protocol library (PCOS 2023; WHO 2025)' },
  { step: 'IUI with ovarian stimulation', chance: 'About 10–15 % per cycle', when: 'twins or more about 8–10 % with stimulation', source: 'Approved protocol library (IUI)' },
];

export const IVF_BANDS = [
  { band: '18–34', rate: 38 },
  { band: '43–44', rate: 8 },
];
export const IVF_ALL_AGES = 30;
export const IVF_SOURCE = 'HFEA (UK), Fertility treatment 2024: trends and figures – preliminary birth rate per embryo transferred, own eggs';

/** Her age band among those published ('' when her age falls outside them, or is not recorded). */
export function ivfBandOf(age) {
  if (age == null || age === '') return '';
  const a = Number(age);
  if (a >= 18 && a <= 34) return '18–34';
  if (a >= 43 && a <= 44) return '43–44';
  return '';
}

export function CounsellingNumbers({ ageYears }) {
  const band = ivfBandOf(ageYears);
  return (
    <section className="card" aria-labelledby="fp-counsel-title">
      <h2 id="fp-counsel-title">
        <Info aria-hidden="true" /> Chances to explain to the couple
      </h2>
      <p className="hint">Figures for groups of couples from published sources – not a prediction for her. Her age, the cause and the time trying change her own chance.</p>
      <div className="dt-wrap">
        <table className="dt">
          <thead>
            <tr>
              <th scope="col">Step</th>
              <th scope="col">Chance</th>
              <th scope="col">Note</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {COUNSELLING_ROWS.map((r) => (
              <tr key={r.step}>
                <td>{r.step}</td>
                <td>{r.chance}</td>
                <td>{r.when}</td>
                <td>{r.source}</td>
              </tr>
            ))}
            <tr>
              <td>IVF or ICSI</td>
              <td>
                {IVF_BANDS.map((b) => (
                  <span key={b.band}>
                    {b.band === band ? <strong>{`Age ${b.band}: ${b.rate} %`}</strong> : `Age ${b.band}: ${b.rate} %`}
                    {' · '}
                  </span>
                ))}
                All ages: {IVF_ALL_AGES} %
              </td>
              <td>per embryo transferred; other age bands not published there{band ? '' : ageYears ? ' – her age is in a band without a figure' : ''}</td>
              <td>{IVF_SOURCE}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
