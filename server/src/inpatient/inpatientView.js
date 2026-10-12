// What the website receives about stays, documents and the nursing chart (pure). Never staff ids.

export const admissionView = (a) => ({
  id: String(a._id),
  patientId: String(a.patientId),
  careType: a.careType,
  admittedAt: a.admittedAt,
  ward: a.ward ?? '',
  bed: a.bed ?? '',
  reason: a.reason ?? '',
  status: a.status,
  dischargedAt: a.dischargedAt ?? null,
  admittedByName: a.admittedByName,
  dischargedByName: a.dischargedByName ?? null,
});

export const documentView = (d) => ({
  id: String(d._id),
  admissionId: String(d.admissionId),
  kind: d.kind,
  status: d.status,
  content: d.content ?? {},
  rev: d.rev ?? 0,
  createdByName: d.createdByName,
  createdAt: d.createdAt,
  savedByName: d.savedByName ?? null,
  savedAt: d.savedAt ?? null,
  signed: d.signed ? { byName: d.signed.byName, role: d.signed.role, at: d.signed.at } : null,
  cancelled: d.cancelled ? { reason: d.cancelled.reason, byName: d.cancelled.byName, at: d.cancelled.at } : null,
  additions: (d.additions ?? []).map((x) => ({ id: String(x._id), text: x.text, byName: x.byName, at: x.at })),
});

export const entryView = (e) => ({
  id: String(e._id),
  kind: e.kind,
  at: e.at,
  vitals: e.kind === 'vitals' ? { bpSystolic: e.vitals?.bpSystolic ?? null, bpDiastolic: e.vitals?.bpDiastolic ?? null, pulse: e.vitals?.pulse ?? null, temperatureF: e.vitals?.temperatureF ?? null, spo2: e.vitals?.spo2 ?? null } : null,
  medicine: e.kind === 'medicine' ? { drug: e.medicine?.drug ?? '', dose: e.medicine?.dose ?? '', route: e.medicine?.route ?? '' } : null,
  note: e.note ?? '',
  byName: e.byName,
  cancelled: e.cancelled ? { reason: e.cancelled.reason, byName: e.cancelled.byName, at: e.cancelled.at } : null,
});
