// Tally's import files, written by hand (no library – like the CSV exports). PURE: no database, no network.
//
// Two files per batch, in the two envelope forms Tally's own samples use (help.tallysolutions.com "Sample XML"):
//  - the entries ("vouchers"): HEADER Import / Data / Vouchers, one <VOUCHER> per entry;
//  - the account names ("masters"): TALLYREQUEST Import Data, REPORTNAME All Masters – only the accounts and voucher
//    types Perinexa has not introduced before (never the GST duty accounts: the accountant creates those with their
//    GST details, which Perinexa does not know).
// Signs: Tally debits a ledger with ISDEEMEDPOSITIVE Yes and a NEGATIVE amount, credits with No and a positive one;
// debits and credits must match to the paisa. Dates are YYYYMMDD. Everything is UTF-8; names are escaped.
// REMOTEID: Tally's own name for the sender's unique id of an entry – an entry sent twice is then overwritten, not
// doubled. Perinexa makes it from the hospital and the entry's key in the shape Tally uses itself.
//
// Checked against Tally's published samples, not yet against a live TallyPrime: the developer compares one entry of
// each kind with an entry made by hand in the accountant's Tally before real use (docs/TALLY_PLAN.md, step 0).

import { createHash } from 'node:crypto';
import { isPartyRole } from './events.js';
import { KIND_TO_TYPE, TALLY_PARENT_TYPES } from './tallyRules.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
/** Text safe inside an element or an attribute (control characters and the two characters XML never allows dropped). */
export const xmlText = (value) =>
  String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/[&<>"']/g, (c) => ESCAPES[c]);

// The GST portal's state names (pharmacy/gstin.js) where Tally's own list spells them differently.
const TALLY_STATE_NAMES = { 'Jammu and Kashmir': 'Jammu & Kashmir', 'Dadra and Nagar Haveli and Daman and Diu': 'Dadra & Nagar Haveli and Daman & Diu', 'Andaman and Nicobar Islands': 'Andaman & Nicobar Islands' };
export const tallyStateName = (state) => TALLY_STATE_NAMES[state] ?? state;

/** A day (midnight UTC) as Tally writes it: 20261016. */
export const tallyDate = (d) => new Date(d).toISOString().slice(0, 10).replace(/-/g, '');
/** Paise → "1234.50" (always two decimals, no grouping, no symbol). */
export const rupeeText = (paise) => (Math.abs(paise) / 100).toFixed(2);

/**
 * The sender's unique id of an entry, the same every time for the same hospital and key, in the 36 + 9 character shape
 * of Tally's own ids (a GUID-like part and a suffix).
 */
export function remoteIdFor(tenantId, key) {
  const h = createHash('sha1').update(`perinexa:${tenantId}:${key}`).digest('hex'); // 40 hex characters
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}-${h.slice(32, 40)}`;
}

const INVOICE_KINDS = new Set(['sales', 'credit_note', 'debit_note']);
const el = (name, value) => `<${name}>${xmlText(value)}</${name}>`;

/**
 * One entry. v: { key, kind, date, narration, lines: [{ role, ledger, paise, side }], remoteId, voucherType (the name
 * in Tally), reference }. Sales, credit and debit notes are written in Tally's invoice view with the party (the account
 * that owes or is owed) first; receipts, payments and journals – and an entry with no party line – in the accounting view.
 */
export function voucherXml(v) {
  const party = INVOICE_KINDS.has(v.kind) ? (v.lines.find((l) => l.role && isPartyRole(l.role)) ?? null) : null;
  const invoice = Boolean(party);
  const view = invoice ? 'Invoice Voucher View' : 'Accounting Voucher View';
  const listTag = invoice ? 'LEDGERENTRIES.LIST' : 'ALLLEDGERENTRIES.LIST';
  const entries = v.lines
    .map((l) => {
      const debit = l.side === 'dr';
      return `<${listTag}>${el('LEDGERNAME', l.ledger)}<ISDEEMEDPOSITIVE>${debit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>${l === party ? '<ISPARTYLEDGER>Yes</ISPARTYLEDGER>' : ''}<AMOUNT>${debit ? '-' : ''}${rupeeText(l.paise)}</AMOUNT></${listTag}>`;
    })
    .join('');
  return (
    `<VOUCHER REMOTEID="${xmlText(v.remoteId)}" VCHTYPE="${xmlText(v.voucherType)}" ACTION="Create" OBJVIEW="${view}">` +
    el('DATE', tallyDate(v.date)) +
    el('EFFECTIVEDATE', tallyDate(v.date)) +
    el('VOUCHERTYPENAME', v.voucherType) +
    el('VOUCHERNUMBER', v.key) +
    (v.reference ? el('REFERENCE', v.reference) : '') +
    (party ? el('PARTYLEDGERNAME', party.ledger) : '') +
    el('PERSISTEDVIEW', view) +
    `<ISINVOICE>${invoice ? 'Yes' : 'No'}</ISINVOICE>` +
    el('NARRATION', v.narration) +
    entries +
    '</VOUCHER>'
  );
}

const header = '<?xml version="1.0" encoding="UTF-8"?>\n';
const message = (inner) => `<TALLYMESSAGE xmlns:UDF="TallyUDF">${inner}</TALLYMESSAGE>`;

/** The entries file of a batch. company: the Tally company's name (so the entries never land in another company). */
export function vouchersXml({ company, vouchers }) {
  return `${header}<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Import</TALLYREQUEST><TYPE>Data</TYPE><ID>Vouchers</ID></HEADER><BODY><DESC><STATICVARIABLES>${el('SVCURRENTCOMPANY', company)}</STATICVARIABLES></DESC><DATA>${vouchers.map((v) => message(voucherXml(v))).join('\n')}</DATA></BODY></ENVELOPE>\n`;
}

/**
 * The account names file of a batch: the voucher types ({ name, parent }) and the accounts ({ name, parent, gstin?,
 * state? }) Perinexa has not introduced before. Every account is created without bill-wise details (the entries carry
 * no bill references; the Patients account is one shared account by the owner's decision). A party with a GSTIN (a
 * business buyer, a supplier) gets it in both shapes Tally has used: the older flat tags and TallyPrime's GST
 * registration and mailing lists, in force from `applicableFrom` (YYYYMMDD, the day the books start).
 */
export function mastersXml({ company, voucherTypes = [], ledgers = [], applicableFrom = '' }) {
  return `${header}<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES>${el('SVCURRENTCOMPANY', company)}</STATICVARIABLES></REQUESTDESC><REQUESTDATA>${masterMessages({ voucherTypes, ledgers, applicableFrom }).join('\n')}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>\n`;
}

/** The voucher types, then the accounts, one TALLYMESSAGE each. */
function masterMessages({ voucherTypes, ledgers, applicableFrom }) {
  const types = voucherTypes.map((t) => message(`<VOUCHERTYPE NAME="${xmlText(t.name)}" ACTION="Create">${el('NAME', t.name)}${el('PARENT', t.parent)}<NUMBERINGMETHOD>Manual</NUMBERINGMETHOD><PREVENTDUPLICATES>Yes</PREVENTDUPLICATES><ISACTIVE>Yes</ISACTIVE></VOUCHERTYPE>`));
  const accounts = ledgers.map((l) => {
    const state = tallyStateName(l.state ?? '');
    const gst = l.gstin
      ? `${el('PARTYGSTIN', l.gstin)}${state ? el('LEDSTATENAME', state) : ''}<GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>` +
        `<LEDGSTREGDETAILS.LIST>${applicableFrom ? el('APPLICABLEFROM', applicableFrom) : ''}<GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>${el('GSTIN', l.gstin)}${state ? el('PLACEOFSUPPLY', state) : ''}</LEDGSTREGDETAILS.LIST>` +
        (state ? `<LEDMAILINGDETAILS.LIST>${applicableFrom ? el('APPLICABLEFROM', applicableFrom) : ''}${el('STATE', state)}<COUNTRY>India</COUNTRY></LEDMAILINGDETAILS.LIST>` : '')
      : '';
    return message(`<LEDGER NAME="${xmlText(l.name)}" ACTION="Create">${el('NAME', l.name)}${el('PARENT', l.parent)}<ISBILLWISEON>No</ISBILLWISEON>${gst}</LEDGER>`);
  });
  return [...types, ...accounts];
}

/**
 * Everything of a batch in ONE file (owner, 19 Oct 2026: the accountant downloads one file and imports it): the new
 * voucher types and accounts first, then the entries, in Tally's Import Data envelope for vouchers – Tally reads the
 * messages in order, so an account exists before the first entry that uses it. The two separate files stay as a
 * fallback. To be tried once on a test company in the accountant's TallyPrime before real use.
 */
export function allInOneXml({ company, voucherTypes = [], ledgers = [], applicableFrom = '', vouchers }) {
  const messages = [...masterMessages({ voucherTypes, ledgers, applicableFrom }), ...vouchers.map((v) => message(voucherXml(v)))];
  return `${header}<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES>${el('SVCURRENTCOMPANY', company)}</STATICVARIABLES></REQUESTDESC><REQUESTDATA>${messages.join('\n')}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>\n`;
}

/** The Tally voucher type (its name in the settings) an entry of this kind uses. */
export const voucherTypeNameFor = (settings, kind) => settings.voucherTypes[KIND_TO_TYPE[kind]];
/** The voucher type masters: Perinexa's names with Tally's built-in parents. */
export const voucherTypeMasters = (settings) => Object.entries(KIND_TO_TYPE).map(([, t]) => ({ name: settings.voucherTypes[t], parent: TALLY_PARENT_TYPES[t] })).filter((x, i, arr) => arr.findIndex((y) => y.name === x.name) === i);

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');
