// Perinexa scan bridge (docs/USG_MACHINE_PLAN.md; how to set it up: scan-bridge/README.md).
// Runs on a PC in the hospital, next to Orthanc (the DICOM receiver the ultrasound machine sends to over the LAN):
//  1. every few seconds, asks Orthanc for studies that have finished arriving, and sends each to Perinexa – its
//     structured reports (the measurements) and a JPEG of each still picture (Orthanc makes it; video clips are left out);
//  2. every few minutes, reads Perinexa's worklist (today's ultrasound orders) and writes it for Orthanc's worklist
//     plugin, so the machine shows the patients and sends back each order's scan number with the study.
// No packages: Node 22 or later only. Settings in scan-bridge/.env (see .env.example) – the bridge key is a secret.
// The pictures and readings are patient data: nothing is written to disk here except the worklist files and the last
// Orthanc change number (bridge-state.json). PC-PNDT: the worklist carries nothing about the sex of a fetus.

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));

/** KEY=VALUE lines (# comments), as in the server's .env. */
export function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

/** The settings, checked: Perinexa over HTTPS (plain HTTP only on this computer), the key, Orthanc. */
export function settingsFrom(env) {
  const problems = [];
  const url = (env.PERINEXA_URL ?? '').replace(/\/+$/, '');
  if (!/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) problems.push('PERINEXA_URL must be https://… (http only for localhost)');
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(env.BRIDGE_KEY ?? '')) problems.push('BRIDGE_KEY: paste the key from Perinexa (Hospital admin → Ultrasound machine)');
  const number = (v, d) => (v ? Number(v) : d);
  return {
    problems,
    perinexaUrl: url,
    bridgeKey: env.BRIDGE_KEY ?? '',
    orthancUrl: (env.ORTHANC_URL || 'http://127.0.0.1:8042').replace(/\/+$/, ''),
    orthancAuth: env.ORTHANC_USER ? `Basic ${Buffer.from(`${env.ORTHANC_USER}:${env.ORTHANC_PASSWORD ?? ''}`).toString('base64')}` : null,
    worklistDir: env.WORKLIST_DIR || '',
    machineAet: env.MACHINE_AET || '',
    pollSeconds: number(env.POLL_SECONDS, 10),
    worklistMinutes: number(env.WORKLIST_MINUTES, 2),
    orthancKeepDays: number(env.ORTHANC_KEEP_DAYS, 30),
    stateFile: env.STATE_FILE || join(HERE, 'bridge-state.json'),
  };
}

/** DICOM date (YYYYMMDD) and time (HHMMSS.ffffff) as a moment in this PC's time zone; null when missing. */
export function dicomMoment(date, time = '') {
  const d = /^(\d{4})(\d{2})(\d{2})$/.exec(String(date ?? '').trim());
  if (!d) return null;
  const t = /^(\d{2})(\d{2})?(\d{2})?/.exec(String(time ?? '').trim()) ?? [];
  const at = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1] ?? 0), Number(t[2] ?? 0), Number(t[3] ?? 0));
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

const dicomDate = (at) => `${at.getFullYear()}${String(at.getMonth() + 1).padStart(2, '0')}${String(at.getDate()).padStart(2, '0')}`;
const dicomTime = (at) => `${String(at.getHours()).padStart(2, '0')}${String(at.getMinutes()).padStart(2, '0')}00`;

/** One worklist entry as the DICOM tags Orthanc's /tools/create-dicom takes (a modality worklist item). */
export function worklistTags(item, { now = new Date(), aet = '' } = {}) {
  const at = item.scheduledFor ? new Date(item.scheduledFor) : now;
  return {
    PatientName: item.patientName,
    PatientID: item.patientId,
    ...(item.age != null ? { PatientAge: `${String(Math.min(999, item.age)).padStart(3, '0')}Y` } : {}),
    AccessionNumber: item.accession,
    RequestedProcedureID: item.accession,
    RequestedProcedureDescription: item.studyName,
    ScheduledProcedureStepSequence: [
      {
        Modality: 'US',
        ...(aet ? { ScheduledStationAETitle: aet } : {}),
        ScheduledProcedureStepStartDate: dicomDate(at),
        ScheduledProcedureStepStartTime: dicomTime(at),
        ScheduledProcedureStepDescription: item.studyName,
        ScheduledProcedureStepID: item.accession,
      },
    ],
  };
}

/** What is sent to Perinexa for one study (Orthanc's study, its first instance's tags, its structured reports). */
export function studyPayload(study, firstTags, srs) {
  const t = study.MainDicomTags ?? {};
  const p = study.PatientMainDicomTags ?? {};
  return {
    studyUid: t.StudyInstanceUID,
    accession: (t.AccessionNumber ?? '').trim(),
    patientId: (p.PatientID ?? '').trim(),
    patientName: (p.PatientName ?? '').trim(),
    studyAt: dicomMoment(t.StudyDate, t.StudyTime),
    manufacturer: (firstTags?.Manufacturer ?? '').trim().slice(0, 64),
    model: (firstTags?.ManufacturerModelName ?? '').trim().slice(0, 64),
    station: (firstTags?.StationName ?? '').trim().slice(0, 64),
    srs,
  };
}

// ---------- Talking to Orthanc and Perinexa ----------

function client(s) {
  const orthanc = async (path, { method = 'GET', body, accept = 'application/json', raw = false } = {}) => {
    const res = await fetch(`${s.orthancUrl}${path}`, {
      method,
      headers: { Accept: accept, ...(s.orthancAuth ? { Authorization: s.orthancAuth } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw Object.assign(new Error(`Orthanc ${method} ${path}: ${res.status}`), { status: res.status, from: 'orthanc' });
    return raw ? Buffer.from(await res.arrayBuffer()) : res.json();
  };
  const perinexa = async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(`${s.perinexaUrl}/api/scan-bridge${path}`, {
      method,
      headers: { Authorization: `Bearer ${s.bridgeKey}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(`Perinexa ${method} ${path}: ${res.status} ${json?.error?.message ?? ''}`.trim()), { status: res.status, from: 'perinexa' });
    return json;
  };
  return { orthanc, perinexa };
}

/** Sends one stable Orthanc study: its reports first (so it is matched), then each still picture. */
export async function sendStudy({ orthanc, perinexa }, studyId, log = console.log) {
  const study = await orthanc(`/studies/${studyId}`);
  const series = await Promise.all((study.Series ?? []).map((id) => orthanc(`/series/${id}`)));
  const kinds = series.map((x) => x.MainDicomTags?.Modality);
  if (!kinds.some((m) => m === 'US' || m === 'SR')) return { skipped: true }; // not from an ultrasound machine
  const srs = [];
  let firstTags = null;
  for (const x of series) {
    for (const id of x.Instances ?? []) {
      if (x.MainDicomTags?.Modality === 'SR') {
        const tags = await orthanc(`/instances/${id}/simplified-tags`);
        if (Array.isArray(tags.ContentSequence)) srs.push({ sopUid: tags.SOPInstanceUID, content: tags.ContentSequence });
        firstTags ??= tags;
      } else firstTags ??= await orthanc(`/instances/${id}/simplified-tags`);
    }
  }
  const sent = await perinexa('/studies', { method: 'POST', body: studyPayload(study, firstTags, srs.slice(0, 20)) });
  let pictures = 0;
  for (const x of series.filter((y) => y.MainDicomTags?.Modality === 'US')) {
    for (const id of x.Instances ?? []) {
      const instance = await orthanc(`/instances/${id}`);
      if (Number(instance.MainDicomTags?.NumberOfFrames ?? 1) > 1) continue; // a video clip
      const jpeg = await orthanc(`/instances/${id}/preview`, { accept: 'image/jpeg', raw: true });
      await perinexa(`/studies/${encodeURIComponent(study.MainDicomTags.StudyInstanceUID)}/images`, {
        method: 'POST',
        body: { sopUid: instance.MainDicomTags.SOPInstanceUID, mediaType: 'image/jpeg', data: jpeg.toString('base64') },
      });
      pictures += 1;
    }
  }
  log(`Study sent: ${srs.length} report(s), ${pictures} picture(s)${sent.matched ? '' : ' – not matched to a patient yet: link it on Perinexa → Scans'}.`);
  return { sent, pictures };
}

/** Writes Perinexa's worklist as .wl files for Orthanc's worklist plugin; removes those no longer on it. */
export async function writeWorklist({ orthanc, perinexa }, s, log = console.log) {
  const { items } = await perinexa('/worklist');
  if (!existsSync(s.worklistDir)) mkdirSync(s.worklistDir, { recursive: true });
  const wanted = new Set(items.map((i) => `${i.accession}.wl`));
  for (const name of readdirSync(s.worklistDir).filter((n) => n.endsWith('.wl') && !wanted.has(n))) unlinkSync(join(s.worklistDir, name));
  let made = 0;
  for (const item of items) {
    const file = join(s.worklistDir, `${item.accession}.wl`);
    if (existsSync(file)) continue;
    // Orthanc makes the DICOM file; it is copied out and removed from Orthanc again
    const created = await orthanc('/tools/create-dicom', { method: 'POST', body: { Tags: worklistTags(item, { aet: s.machineAet }), Force: true } });
    writeFileSync(file, await orthanc(`/instances/${created.ID}/file`, { accept: 'application/dicom', raw: true }));
    await orthanc(`/instances/${created.ID}`, { method: 'DELETE' });
    made += 1;
  }
  if (made) log(`Worklist: ${items.length} patient(s), ${made} new.`);
}

// Never sent however often it is tried: gone from Orthanc (e.g. a worklist file's own copy), or refused by Perinexa as
// it is (except a wrong key or too many requests, which are fixed by waiting or by the admin)
export const skipAfter = (err) => (err.from === 'orthanc' && err.status === 404) || (err.from === 'perinexa' && err.status >= 400 && err.status < 500 && ![401, 408, 429].includes(err.status));

/** Deletes from Orthanc the studies done more than keepDays ago (patient data is kept only as long as needed). */
export async function deleteOld({ orthanc }, keepDays, log = console.log, now = new Date()) {
  const before = new Date(now.getFullYear(), now.getMonth(), now.getDate() - keepDays);
  const ids = await orthanc('/tools/find', { method: 'POST', body: { Level: 'Study', Query: { StudyDate: `-${dicomDate(before)}` } } });
  for (const id of ids) await orthanc(`/studies/${id}`, { method: 'DELETE' });
  if (ids.length) log(`Deleted ${ids.length} stud${ids.length === 1 ? 'y' : 'ies'} older than ${keepDays} days from Orthanc.`);
}

const loadState = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { since: null };
  }
};

async function main() {
  const s = settingsFrom({ ...readEnvFile(join(HERE, '.env')), ...process.env });
  if (s.problems.length) {
    console.error(`Scan bridge settings (scan-bridge/.env):\n - ${s.problems.join('\n - ')}`);
    process.exit(1);
  }
  const c = client(s);
  const state = loadState(s.stateFile);
  // First start: begin from now – studies already in Orthanc are not sent again
  if (state.since == null) state.since = (await c.orthanc('/changes?last')).Last ?? 0;
  console.log(`Scan bridge running: Orthanc ${s.orthancUrl} → ${s.perinexaUrl}${s.worklistDir ? `, worklist in ${s.worklistDir}` : ''}.`);
  let nextWorklist = 0;
  let nextClean = 0;
  for (;;) {
    try {
      const page = await c.orthanc(`/changes?since=${state.since}&limit=100`);
      for (const ch of page.Changes ?? []) {
        if (ch.ChangeType === 'StableStudy') {
          try {
            await sendStudy(c, ch.ID);
          } catch (err) {
            if (!skipAfter(err)) throw err; // the network or a server is down: tried again on the next round
            console.error(`A study was left out: ${err.message}`);
          }
        }
        state.since = ch.Seq;
        writeFileSync(s.stateFile, JSON.stringify(state));
      }
      if (s.worklistDir && Date.now() >= nextWorklist) {
        await writeWorklist(c, s);
        nextWorklist = Date.now() + s.worklistMinutes * 60 * 1000;
      }
      if (Date.now() >= nextClean) {
        await deleteOld(c, s.orthancKeepDays);
        nextClean = Date.now() + 60 * 60 * 1000;
      }
      if (!page.Done) continue;
    } catch (err) {
      console.error(`${new Date().toLocaleTimeString()} ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, s.pollSeconds * 1000));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
