// Demo of the ultrasound machine without a machine (docs/USG_MACHINE_PLAN.md; scan-bridge/README.md "Try it without a
// machine"). Plays the machine and the bridge once: reads Perinexa's worklist, and sends a MADE-UP study for the first
// ultrasound order on it – a structured report with repeated readings (BPD three times, HC, AC and FL twice …) and three
// generated sample pictures, as the real bridge would. Sample data only: never point it at a live hospital.
//   node scan-bridge/demo.mjs                 → the first ultrasound order on today's worklist
//   node scan-bridge/demo.mjs P-000123        → that patient, matched by her patient number (no order needed)
// Settings: PERINEXA_URL and BRIDGE_KEY in scan-bridge/.env (see .env.example), e.g. http://localhost:4001 on this PC.

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { readEnvFile, settingsFrom } from './bridge.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));

// ---------- A sample picture: a grey PNG drawn here (no packages), with "SAMPLE" on it ----------

const FONT = {
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
};

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Picture n (1, 2, 3) of the demo: a speckled grey "scan" with an oval, a ring and calipers – a PNG. */
export function samplePng(n, w = 480, h = 360) {
  const px = new Uint8Array(w * h);
  let seed = 12345 + n * 977;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const [cx, cy, rx, ry] = [w / 2, h / 2 + 20, 150 - n * 18, 105 - n * 6];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      const fan = Math.abs(x - cx) < (y + 40) * 0.95; // the sector a probe sees
      let v = fan ? 20 + noise() * 45 : 0;
      if (fan && d < 1) v = 70 + (1 - d) * 90 + noise() * 40;
      if (fan && Math.abs(Math.sqrt(d) - 0.72) < 0.025) v = 230;
      px[y * w + x] = Math.min(255, v);
    }
  }
  // Calipers across the oval
  for (let x = Math.round(cx - rx * 0.72); x <= cx + rx * 0.72; x += 6) for (let t = -1; t <= 1; t += 1) px[Math.round(cy + t) * w + x] = 255;
  // "SAMPLE" in the corner, 3 px per dot
  [...'SAMPLE'].forEach((ch, i) =>
    FONT[ch].forEach((row, r) =>
      [...row].forEach((on, c) => {
        if (on === '1') for (let a = 0; a < 3; a += 1) for (let b = 0; b < 3; b += 1) px[(12 + r * 3 + a) * w + 12 + i * 18 + c * 3 + b] = 255;
      }),
    ),
  );
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y += 1) Buffer.from(px.subarray(y * w, (y + 1) * w)).copy(raw, y * (w + 1) + 1); // filter 0 per row
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bits
  ihdr[9] = 0; // grey
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- A made-up structured report (DICOM TID 5000, as Orthanc's simplified JSON) ----------

const code = (CodeValue, CodeMeaning, CodingSchemeDesignator = 'LN') => [{ CodeValue, CodeMeaning, CodingSchemeDesignator }];
const num = (c, meaning, value, unit, extra = {}) => ({ ValueType: 'NUM', ConceptNameCodeSequence: code(c, meaning), MeasuredValueSequence: [{ NumericValue: String(value), MeasurementUnitsCodeSequence: code(unit, unit, 'UCUM') }], ...extra });
const MEAN = { ContentSequence: [{ ValueType: 'CODE', ConceptNameCodeSequence: code('121401', 'Derivation', 'DCM'), ConceptCodeSequence: code('R-00317', 'Mean', 'SRT') }] };

/** Third-trimester biometry with repeated readings, the machine's own mean for BPD, one it has no field for. */
export function demoReport() {
  return [
    {
      ValueType: 'CONTAINER',
      ConceptNameCodeSequence: code('125002', 'Fetal Biometry', 'DCM'),
      ContentSequence: [
        { ValueType: 'TEXT', ConceptNameCodeSequence: code('11951-1', 'Fetus ID'), TextValue: 'A' },
        num('11820-8', 'Biparietal Diameter', 78.1, 'mm'),
        num('11820-8', 'Biparietal Diameter', 78.6, 'mm'),
        num('11820-8', 'Biparietal Diameter', 77.9, 'mm'),
        num('11820-8', 'Biparietal Diameter', 78.2, 'mm', MEAN),
        num('11984-2', 'Head Circumference', 28.5, 'cm'),
        num('11984-2', 'Head Circumference', 28.9, 'cm'),
        num('11979-2', 'Abdominal Circumference', 270.4, 'mm'),
        num('11979-2', 'Abdominal Circumference', 272.0, 'mm'),
        num('11963-6', 'Femur Length', 60.2, 'mm'),
        num('11963-6', 'Femur Length', 59.8, 'mm'),
        num('11948-7', 'Fetal Heart Rate', 142, '{H.B.}/min'),
        num('99DEMO', 'Transcerebellar diameter', 35.1, 'mm'),
      ],
    },
    { ValueType: 'CONTAINER', ConceptNameCodeSequence: code('121070', 'Findings', 'DCM'), ContentSequence: [num('11627-7', 'Amniotic Fluid Index', 12.1, 'cm'), num('99DEMO', 'Deepest vertical pocket', 4.6, 'cm')] },
  ];
}

// A new DICOM UID each run (2.25 + a random number, as DICOM allows)
const newUid = () => `2.25.${BigInt(`0x${randomBytes(15).toString('hex')}`)}`;

/**
 * Sends the demo study. send(method, path, body) → { status, body }: Perinexa's /api/scan-bridge with the key.
 * patientNumber: her patient number, when the study is matched by it instead of the worklist.
 */
export async function runDemo({ send, patientNumber = '', log = console.log, now = new Date() }) {
  const worklist = await send('GET', '/worklist');
  if (worklist.status !== 200) throw new Error(`Perinexa refused the bridge key (${worklist.status}). Make a key in Hospital admin → Ultrasound machine and put it in scan-bridge/.env.`);
  const item = patientNumber ? null : worklist.body.items[0];
  if (!item && !patientNumber) throw new Error('No ultrasound scan is ordered or booked for today. Order one for a sample patient (her Lab tab → Order a scan), or run: node scan-bridge/demo.mjs <her patient number>');
  const studyUid = newUid();
  const study = {
    studyUid,
    accession: item?.accession ?? '',
    patientId: item?.patientId ?? patientNumber,
    patientName: (item?.patientName ?? '').toUpperCase().replace(/\s+/g, '^'),
    studyAt: now.toISOString(),
    manufacturer: 'Demo',
    model: 'Sample machine',
    station: 'DEMO',
    srs: [{ sopUid: `${studyUid}.1`, content: demoReport() }],
  };
  const sent = await send('POST', '/studies', study);
  if (sent.status >= 300) throw new Error(`The study was refused: ${sent.status} ${sent.body?.error?.message ?? ''}`);
  for (const n of [1, 2, 3]) {
    const res = await send('POST', `/studies/${studyUid}/images`, { sopUid: `${studyUid}.${10 + n}`, mediaType: 'image/png', data: samplePng(n).toString('base64') });
    if (res.status >= 300) throw new Error(`A picture was refused: ${res.status} ${res.body?.error?.message ?? ''}`);
  }
  const who = item ? `${item.patientName} (${item.patientId}), scan number ${item.accession} – ${item.studyName}` : `patient number ${patientNumber}`;
  log(`Sent a made-up study for ${who}: ${sent.body.readings} readings, 3 pictures – ${sent.body.matched ? 'matched' : 'NOT matched (Scans → From the ultrasound machine → link it)'}.`);
  return { ...sent.body, item, studyUid };
}

async function main() {
  const s = settingsFrom({ ...readEnvFile(join(HERE, '.env')), ...process.env });
  const problems = s.problems;
  if (problems.length) {
    console.error(`Demo settings (scan-bridge/.env):\n - ${problems.join('\n - ')}`);
    process.exit(1);
  }
  const send = async (method, path, body) => {
    const res = await fetch(`${s.perinexaUrl}/api/scan-bridge${path}`, {
      method,
      headers: { Authorization: `Bearer ${s.bridgeKey}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  try {
    await runDemo({ send, patientNumber: (process.argv[2] ?? '').trim() });
    console.log('Now in Perinexa: Sonography → open her scan → From the machine (mark the scan done to add pictures and fill the report).');
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
