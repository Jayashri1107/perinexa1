// Pharmacy stock while prescribing: whether each medicine being written is in the hospital's pharmacy. The server
// answers only "in", "low" or "out" for a medicine it can match with confidence (POST /pharmacy-stock/check) – never
// quantities or prices – and nothing when it cannot, or when the hospital keeps no medicines in the Pharmacy module.

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';

/** The words shown beside a medicine: status = colour + icon + word. */
export const STOCK_STATUS = {
  in: { tone: 'stable', word: 'In the pharmacy' },
  low: { tone: 'watch', word: 'In the pharmacy – low stock' },
  out: { tone: 'inactive', word: 'Not in stock' },
};

/** What identifies a line for the stock check: the medicine, its strength and its form as typed. */
export const stockKey = (row) => [(row.drug ?? '').trim().toLowerCase(), (row.strength ?? '').trim().toLowerCase(), row.form ?? ''].join('|');

/** The lines worth asking about (a name of at least 3 letters), once each: [{ key, drug, strength, form }]. */
export function stockQuestions(rows, known = new Map()) {
  const out = new Map();
  for (const r of rows) {
    const drug = (r.drug ?? '').trim();
    if (drug.length < 3) continue;
    const key = stockKey(r);
    if (!known.has(key) && !out.has(key)) out.set(key, { key, drug, strength: (r.strength ?? '').trim().slice(0, 40), ...(r.form ? { form: r.form } : {}) });
  }
  return [...out.values()].slice(0, 40);
}

const WAIT_MS = 700; // after the last keystroke

/**
 * The stock status of the lines being written: returns stockOf(row) → 'in' | 'low' | 'out' | null.
 * Asks only about lines not asked about before, a moment after typing stops. It stops asking (and shows nothing)
 * when the hospital has no pharmacy list, when this person may not see it, or when the server can't be reached.
 */
export function useStockStatus(rows, enabled) {
  const [known, setKnown] = useState(() => new Map());
  const [off, setOff] = useState(false);
  const questions = useMemo(() => (enabled && !off ? stockQuestions(rows, known) : []), [rows, known, enabled, off]);
  const signature = questions.map((q) => q.key).join('\n');
  const latest = useRef(questions);
  latest.current = questions;

  useEffect(() => {
    if (!signature) return undefined;
    let alive = true;
    const timer = setTimeout(async () => {
      const asked = latest.current;
      try {
        const res = await api('/pharmacy-stock/check', { method: 'POST', body: { medicines: asked.map(({ drug, strength, form }) => ({ drug, strength, ...(form ? { form } : {}) })) } });
        if (!alive) return;
        if (!res.pharmacy) return setOff(true);
        setKnown((old) => {
          const next = new Map(old);
          asked.forEach((q, i) => next.set(q.key, res.stock?.[i] ?? null));
          return next;
        });
      } catch {
        if (alive) setOff(true);
      }
    }, WAIT_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [signature]);

  return useMemo(() => (row) => (off ? null : (known.get(stockKey(row)) ?? null)), [known, off]);
}
