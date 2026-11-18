import { useState } from 'react';
import { Link } from 'react-router-dom';

// Reports → All topics (18 Nov 2026, the pharmacy department's handwritten list of 16 Nov 2026): every topic of the
// list, in its groups and order and by its own name, with where it is in Perinexa and a button that opens it.
// [name on the list, where it opens (null: not built), how to use it there]
const report = (key) => `/pharmacy/reports?view=list&report=${key}`;
export const PHARMACY_TOPICS = [
  {
    title: 'Pharmacy',
    items: [
      ['Sale bill', '/pharmacy', 'Sales bill: choose OPD, IPD or External, then the patient.'],
      ['Search sale bill', '/pharmacy', 'Sales bill: the search on the left (name, mobile, UHID, dates), or the box above the bills (bill number).'],
      ['Current stock', '/pharmacy/stock', 'Stock: every medicine with what is left.'],
      ['Sale return patient-wise', report('patient-returns'), 'Each patient’s returns in the period.'],
      ['Sale return bill-wise (External)', '/pharmacy', 'Open the bill → Take medicines back. A walk-in gets the money back at once.'],
      ['Discharge clearance pharmacy', '/pharmacy/discharge-clearance', 'Discharged patients waiting to leave, with what they owe the pharmacy.'],
      ['Sale window', '/pharmacy', 'The bill itself (Sales bill).'],
      ['Advance', '/pharmacy', 'Click the patient’s name → Advance: Take advance, Use on bills due, Refund.'],
      ['Item movement', '/pharmacy/stock', 'Stock → a medicine → Stock moves.'],
      ['MRP adjustment', '/pharmacy/stock', 'Stock → a medicine → Change MRP on the batch.'],
      ['Batch adjustment', '/pharmacy/stock', 'Stock → a medicine → Count, Write off, Put on hold.'],
      ['Add stock', '/pharmacy/purchases/new', 'A new purchase bill (GRN).'],
      ['Settlement', '/pharmacy', 'Click the patient’s name → Settle credit: one payment for all the bills due.'],
      ['Search sale return', '/pharmacy', 'Type the return number (CN-…) in the box above the bills.'],
    ],
  },
  {
    title: 'Pharmacy reports',
    items: [
      ['Sale collection report', report('collection'), 'Details or Summary.'],
      ['Sale bill details report', report('sale-lines'), 'Every medicine sold.'],
      ['Card collection report', report('card-collection'), ''],
      ['UPI collection report', report('upi-collection'), ''],
      ['Patient-wise collection report', report('patient-collection'), ''],
      ['Doctor-wise sale', '/pharmacy/reports?view=by-doctor', ''],
      ['Credit report', report('credit'), ''],
      ['Advance amount report', report('advance'), 'Deposits, uses and refunds.'],
      ['Expiry item list', '/pharmacy/reports', 'Stock alerts: expiring within 90 days, or expired.'],
      ['Generic name add', '/pharmacy/medicines', 'Medicines → a medicine → Generic name.'],
      ['New item add', '/pharmacy/medicines', 'Medicines → Add a medicine.'],
      ['Patient-wise credit report', report('patient-credit'), ''],
      ['Insurance / cashless patient report', report('insurance'), 'Pharmacy bills on a hospital bill with insurance.'],
      ['Right claim patient report', null, 'Not built yet: the pharmacy is asked what it should show.'],
      ['Total reports – details and summary', report('sales'), 'Every report with dates has Details and Summary.'],
    ],
  },
  {
    title: 'Purchase reports',
    items: [
      ['GRN report', report('grn'), 'Summary or Detail.'],
      ['GRN return report', report('grn-return'), ''],
      ['Purchase order', '/pharmacy/orders', 'Also a report in the Report list.'],
      ['Item-wise GRN list', report('item-grn'), ''],
      ['Item (company)-wise GRN list and report', report('company-grn'), 'By manufacturer; Summary or Detail.'],
      ['Supplier-wise GRN report', report('supplier-grn'), ''],
      ['Non-moving item list', report('non-moving'), ''],
      ['Expenses report', null, 'In Billing → Daily expenses (the billing desk and the admin). A pharmacy-only list is to be asked.'],
      ['Vendor payment status', '/pharmacy/suppliers', 'Suppliers → a supplier → what is owed and paid.'],
      ['Purchase return (expiry / near expiry)', '/pharmacy/supplier-returns/new', 'Choose “Expired or near expiry”.'],
      ['Opening balance (add item)', '/pharmacy/stock/import', 'Import a file, or add one item by hand.'],
      ['New supplier add', '/pharmacy/suppliers', 'Suppliers → Add a supplier.'],
      ['Item ledger', report('stock-datewise'), 'Or Stock → a medicine → Stock moves.'],
    ],
  },
];

/** A topic fits what was typed in the search box: its name or what it says, any case. */
export const topicFits = ([name, , how], text) => !text.trim() || `${name} ${how}`.toLowerCase().includes(text.trim().toLowerCase());

export function PharmacyTopics() {
  const [text, setText] = useState('');
  let n = 0;
  return (
    <div className="ph-topics">
      <section className="card ph-topics-intro" aria-label="How to use this list">
        <p>
          Every topic from the pharmacy’s list, by the same name. Find the topic (or type a word below), read the short line under it – that is what to do on that screen – and press <strong>Open</strong> to go there.
        </p>
        <input type="search" className="ph-topics-find" aria-label="Find a topic" placeholder="Find a topic, e.g. credit, expiry, GRN" value={text} onChange={(e) => setText(e.target.value)} />
      </section>
      <div className="ph-topics-groups">
        {PHARMACY_TOPICS.map((g) => {
          const items = g.items.map((it) => ({ it, no: ++n })).filter(({ it }) => topicFits(it, text));
          if (!items.length) return null;
          return (
            <section key={g.title} className="card ph-topics-group" aria-label={g.title}>
              <h2>{g.title}</h2>
              <ol className="ph-topic-list">
                {items.map(({ it: [name, to, how], no }) => (
                  <li key={name}>
                    <span className="ph-topic-no">{no}</span>
                    <div className="ph-topic-text">
                      <strong>{name}</strong>
                      {how && <span>{how}</span>}
                    </div>
                    {to ? (
                      <Link className="btn btn-secondary btn-sm" to={to}>
                        Open
                      </Link>
                    ) : (
                      <span className="ph-topic-none">Not built</span>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}
