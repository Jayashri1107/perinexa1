import { useState } from 'react';
import { Printer } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { formatDate } from '../ui.jsx';
import { Letterhead } from './Letterhead.jsx';
import { PrintDocument, PrintPreview } from './PrintPreview.jsx';

// Printing a record as the manual's page (Clinical Requirements Group C – PX-X-03): A4, the hospital's letterhead and,
// beside it, the form's box – its code, title and the version in force on the record's day from the document register
// (PX-X-02). With no approved version in the register the box says so, so an uncontrolled printout is never mistaken
// for the manual's form. The header repeats on every page.

/** The form box at the top of a printed page. form: { code, title, version, effectiveFrom } or null. */
export function FormBox({ form, screenLabel }) {
  return (
    <div className="mp-formbox">
      {form ? (
        <>
          <div className="mp-code">{form.code}</div>
          <div>{form.title}</div>
          <div>{`Version ${form.version} · in force from ${formatDate(form.effectiveFrom)}`}</div>
        </>
      ) : (
        <>
          <div className="mp-code">No form code</div>
          <div>{`${screenLabel}: not in the document register yet`}</div>
        </>
      )}
    </div>
  );
}

/**
 * A "Print as the manual's page" button and its preview. screen: the register's screen key; on: the record's day
 * ('YYYY-MM-DD'); title: what is printed (never a patient's name – it can print in the browser's header); footer: an
 * optional line repeated at the foot of every page (e.g. "NEO-F-03 · v1.0").
 */
export function ManualPrint({ screen, on, title, footer, children }) {
  const [open, setOpen] = useState(false);
  const form = useFetch(open ? '/forms/in-force' : null, { screen, on });
  const lh = useFetch(open ? '/tenant/settings/letterhead' : null);
  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
        <Printer aria-hidden="true" /> Print as the manual’s page
      </button>
      {open && (
        <PrintPreview title={title} onClose={() => setOpen(false)} docKey={form.data && lh.data ? `${screen}-${on}` : null} pageNumbers>
          {form.data && lh.data && (
            <PrintDocument
              className="mp-doc"
              footer={footer}
              head={
                <div className="mp-head">
                  <Letterhead letterhead={lh.data.letterhead} />
                  <FormBox form={form.data.form} screenLabel={form.data.screen.label} />
                </div>
              }
            >
              {children}
            </PrintDocument>
          )}
        </PrintPreview>
      )}
    </>
  );
}
