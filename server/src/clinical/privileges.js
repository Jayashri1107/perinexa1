// Clinical privileges (Clinical Requirements Group C – PX-X-07): which member of staff the hospital allows to do which
// procedure. DRAFT list – the owner (a doctor) approves the list and wording before real use; each hospital decides who
// holds which privilege. Perinexa keeps the register and shows the check; the legal registrations behind some of them
// (MTP Act, PC-PNDT, ART Act) stay the hospital's own duty and are not checked here.

export const PRIVILEGE_SOURCE = 'DRAFT – Perinexa list of clinical privileges (PX-X-07), awaiting the owner’s approval';

// role: who may hold it (the staff roles of a hospital); theatre: offered on the theatre case for the surgeon or the
// anaesthetist; law: a reminder shown beside it.
export const PRIVILEGES = {
  caesarean: { label: 'Caesarean section', role: 'doctor', theatre: 'surgeon' },
  operative_vaginal: { label: 'Operative vaginal birth (vacuum, forceps)', role: 'doctor' },
  perineal_complex: { label: 'Repair of third- and fourth-degree tears', role: 'doctor', theatre: 'surgeon' },
  hysterectomy: { label: 'Hysterectomy', role: 'doctor', theatre: 'surgeon' },
  laparoscopy: { label: 'Laparoscopic surgery', role: 'doctor', theatre: 'surgeon' },
  hysteroscopy: { label: 'Hysteroscopy', role: 'doctor', theatre: 'surgeon' },
  cerclage: { label: 'Cervical cerclage', role: 'doctor', theatre: 'surgeon' },
  ectopic: { label: 'Surgery for ectopic pregnancy', role: 'doctor', theatre: 'surgeon' },
  mtp_surgical: { label: 'Surgical termination of pregnancy', role: 'doctor', theatre: 'surgeon', law: 'MTP Act: a registered medical practitioner with the required training, at an approved place.' },
  minor_gynae: { label: 'Minor gynaecological procedures (D&C, biopsy)', role: 'doctor', theatre: 'surgeon' },
  obstetric_scan: { label: 'Obstetric ultrasound', role: 'doctor', law: 'PC-PNDT: only at a registered centre, by a doctor named in its registration.' },
  art_procedures: { label: 'Egg collection and embryo transfer', role: 'doctor', theatre: 'surgeon', law: 'ART Act: only at a registered clinic.' },
  general_anaesthesia: { label: 'General anaesthesia', role: 'doctor', theatre: 'anaesthetist' },
  regional_anaesthesia: { label: 'Spinal and epidural anaesthesia', role: 'doctor', theatre: 'anaesthetist' },
  neonatal_intubation: { label: 'Newborn intubation', role: 'doctor' },
  newborn_resuscitation: { label: 'Newborn resuscitation (NRP)', role: 'any' },
};
export const PRIVILEGE_KEYS = Object.keys(PRIVILEGES);
export const SURGEON_PRIVILEGES = PRIVILEGE_KEYS.filter((k) => PRIVILEGES[k].theatre === 'surgeon');
// The anaesthetist's privilege a theatre case needs, by its anaesthesia.
export const ANAESTHESIA_PRIVILEGE = { general: 'general_anaesthesia', spinal: 'regional_anaesthesia', epidural: 'regional_anaesthesia' };
