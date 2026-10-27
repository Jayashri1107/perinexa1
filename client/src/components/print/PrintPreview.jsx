import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileDown, FileText, MessageCircle, Printer, Send, Share2, TriangleAlert } from 'lucide-react';
import { MenuButton } from '../MenuButton.jsx';
import { Alert, useDialogFocus } from '../ui.jsx';
import { FITS, canSharePdf, downloadFile, makePdf, paperPages } from './pdfExport.js';

const PDF_CARE = 'Send it only to the patient or to your hospital’s staff. On a computer others use, delete the file once it is sent.';
const pagesWord = (n) => `${n} ${n === 1 ? 'page' : 'pages'}`;
const FITTED = ['', 'the parts are spaced a little closer', 'the text is a little smaller and the parts closer'];

/**
 * The print preview: the document exactly as it prints (A4), shown over the whole app with Print and Close.
 * While it is open the app itself is left out of the printout (print.css), so only the document prints.
 * - title: what is being printed, e.g. "Care plan – patient copy". It is also the browser tab's title while
 *   the preview is open, which browsers may print at the top of the page – so it never contains a patient's name.
 * - onPrint(): runs just before the browser's print window opens (e.g. to record the printout). If it fails,
 *   its message is shown and nothing is printed.
 * - hint: a line under the title (defaults to the A4 reminder); controls: choices shown under it.
 * - autoPrint: open the browser's print window by itself once the preview is shown (a scan report completed).
 * - page: the paper, when it isn't A4 with 12 mm margins: { size: 'A4' | 'A5', margin: '12mm' | '45mm 12mm 20mm' }
 *   (used for printing and for the sheet on screen).
 * Optional (prescriptions):
 * - pdf: { fileName, title, onSaved(way), whatsapp? } – Download PDF, and Share PDF where the browser can hand a file
 *   to other apps. The PDF is made in this browser from the document on screen (pdfExport.js); onSaved('download' |
 *   'share' | 'whatsapp') records it – a download only after it is recorded, a share or WhatsApp (which must open at
 *   once) just after. whatsapp: { href, label } – Send on WhatsApp: a link that opens a chat with the patient's number
 *   (label: the number as shown) while the PDF is saved to attach there.
 *   sendNow: { label, practice, send(blob) } – Send on WhatsApp now: the PDF is sent to the patient in one click from
 *   the hospital's own WhatsApp number (when the hospital has set that up), after asking once. It replaces the link.
 *   share: false – Download PDF only, as a plain button: never the share window of the browser (the copy of a whole
 *   record). The PDF is then made when Download PDF is pressed, not in advance (a long document takes a while).
 * - fit: the document may be fitted more closely when that saves a page – first its parts spaced closer, then its
 *   text a little smaller too (pdfExport.js FITS). The preview says how many pages it prints on.
 * - docKey: changes whenever the document changes (null while it is still loading), so the pages are counted again.
 */
/**
 * What was worked out for this document (the pages counted, the PDF made), or null. Not yet worked out is null –
 * also when there is no docKey (consent forms and care-plan copies: nothing is counted), where `undefined ===
 * undefined` used to pass and the preview broke with nothing on the screen.
 */
export const forDocument = (result, docKey) => (result && result.key === docKey ? result : null);

export function PrintPreview({ title, hint, controls, onPrint, onClose, page, pdf, fit = false, docKey, autoPrint = false, pageNumbers = false, children }) {
  const ref = useDialogFocus(onClose);
  const sheet = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [paper, setPaper] = useState(null); // { key, pages, fit } once counted
  const [made, setMade] = useState(null); // { key, blob } or { key, failed }: the PDF, made in advance so Share can open at once
  const [pdfBusy, setPdfBusy] = useState(false);
  const [asking, setAsking] = useState(false); // "Send on WhatsApp now" was chosen: asked once before it goes
  const downloadOnly = pdf?.share === false;
  const [sharing] = useState(() => Boolean(pdf) && pdf.share !== false && canSharePdf());
  const fitted = forDocument(paper, docKey)?.fit ?? 0;

  useEffect(() => {
    document.body.classList.add('pv-open');
    const before = document.title;
    document.title = `${title} · Perinexa`;
    return () => {
      document.body.classList.remove('pv-open');
      document.title = before;
    };
  }, [title]);

  // The pages, counted on the paper itself (and a closer fit tried); then the PDF, made in advance
  useEffect(() => {
    if (!pdf && !fit) return undefined;
    const doc = docKey === null ? null : sheet.current?.querySelector('.pdoc');
    if (!doc) return undefined;
    let alive = true;
    setNotice(null);
    (async () => {
      try {
        const counted = await paperPages(doc, page, { canFit: fit });
        if (!alive) return;
        setPaper({ key: docKey, ...counted });
        if (pdf && pdf.share !== false) {
          const blob = await makePdf(doc, page, { fit: counted.fit, title: pdf.title, pageNumbers });
          if (alive) setMade({ key: docKey, blob });
        }
      } catch (err) {
        if (import.meta.env.DEV) console.warn(`print: ${err?.message}`); // Print still works; Download PDF tries again and says why it can't
        if (alive) setMade({ key: docKey, failed: true });
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- counted again only when the document changes
  }, [docKey]);

  const print = async () => {
    setBusy(true);
    setError(null);
    try {
      await onPrint?.();
      window.print();
    } catch (err) {
      setError(`Nothing was printed. ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  // Printed by itself once the sheet is laid out (a start that is undone – React's double start in development – also
  // undoes its timer, so it still prints once)
  useEffect(() => {
    if (!autoPrint) return undefined;
    const t = setTimeout(print, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the preview opens
  }, []);

  const ready = forDocument(made, docKey)?.blob ?? null;
  const failed = Boolean(forDocument(made, docKey)?.failed);
  const download = async () => {
    setPdfBusy(true);
    setError(null);
    setNotice(null);
    try {
      const blob = ready ?? (await makePdf(sheet.current.querySelector('.pdoc'), page, { fit: fitted, title: pdf.title, pageNumbers }));
      await pdf.onSaved('download');
      downloadFile(blob, pdf.fileName);
      setNotice(`Saved as “${pdf.fileName}” in your Downloads folder. ${PDF_CARE}`);
    } catch (err) {
      setError(`No PDF was saved. ${err.message}`);
    } finally {
      setPdfBusy(false);
    }
  };
  // WhatsApp: the link opens the chat in a new tab (a real link, so the browser never blocks it) while the PDF is saved
  // here, to be attached there
  const sendWhatsApp = async (e) => {
    if (pdfBusy) {
      e.preventDefault();
      return;
    }
    setError(null);
    setNotice(null);
    let blob = ready;
    if (!blob) {
      setPdfBusy(true);
      try {
        blob = await makePdf(sheet.current.querySelector('.pdoc'), page, { fit: fitted, title: pdf.title, pageNumbers });
      } catch (err) {
        setError(`No PDF was saved to attach. ${err.message}`);
        return;
      } finally {
        setPdfBusy(false);
      }
    }
    downloadFile(blob, pdf.fileName);
    setNotice(
      `WhatsApp opens a chat with ${pdf.whatsapp.label}, the number on the patient’s record. Attach “${pdf.fileName}” from your Downloads ` +
        `folder (the paperclip, then Document), check that it is the right patient, and press Send. ${PDF_CARE}`,
    );
    try {
      await pdf.onSaved('whatsapp');
    } catch (err) {
      setError(`The PDF was saved, but this could not be recorded: ${err.message}`);
    }
  };
  // Sent to the patient in one click, from the hospital's WhatsApp number (the server sends it, and records it)
  const sendNow = async () => {
    setPdfBusy(true);
    setError(null);
    setNotice(null);
    try {
      const blob = ready ?? (await makePdf(sheet.current.querySelector('.pdoc'), page, { fit: fitted, title: pdf.title, pageNumbers }));
      const out = await pdf.sendNow.send(blob);
      setAsking(false);
      setNotice(out?.practice ? `Practice mode: nothing was sent. With WhatsApp set up, this would go to ${pdf.sendNow.label}.` : `Sent on WhatsApp to ${pdf.sendNow.label}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setPdfBusy(false);
    }
  };
  // The share window must open straight after the click, so the PDF made in advance is used
  const share = async () => {
    if (!ready) return;
    setError(null);
    setNotice(null);
    try {
      await navigator.share({ files: [new File([ready], pdf.fileName, { type: 'application/pdf' })], title: pdf.title });
    } catch (err) {
      if (err?.name !== 'AbortError') setError('The PDF was not shared. Use Download PDF instead.');
      return; // (closed without sharing)
    }
    try {
      await pdf.onSaved('share');
      setNotice(`Shared as “${pdf.fileName}”. ${PDF_CARE}`);
    } catch (err) {
      setError(`The PDF was shared, but this could not be recorded: ${err.message}`);
    }
  };

  const counted = forDocument(paper, docKey);
  return createPortal(
    <div ref={ref} tabIndex={-1} className="pv" role="dialog" aria-modal="true" aria-labelledby="pv-title">
      <div className="pv-bar">
        <span className="pv-bar-icon" aria-hidden="true">
          <FileText />
        </span>
        <div className="pv-bar-text">
          <h2 id="pv-title">
            {title}
            {counted && <span className="pv-pages-pill">{pagesWord(counted.pages)}</span>}
          </h2>
          <p className="hint">{hint ?? 'Check the page, then print it on A4 paper.'}</p>
          {counted && (
            <p className="hint pv-pages">
              {counted.fit ? `Fitted on ${pagesWord(counted.pages)}: ${FITTED[counted.fit]}.` : `Prints on ${pagesWord(counted.pages)}.`}
            </p>
          )}
          {controls}
        </div>
        <div className="row pv-actions">
          <button type="button" className="btn btn-primary" onClick={print} disabled={busy}>
            <Printer aria-hidden="true" /> {busy ? 'Preparing…' : 'Print'}
          </button>
          {downloadOnly && (
            <button type="button" className="btn btn-secondary" onClick={download} disabled={pdfBusy}>
              <FileDown aria-hidden="true" /> {pdfBusy ? 'Making the PDF…' : 'Download PDF'}
            </button>
          )}
          {pdf && !downloadOnly && (
            <MenuButton
              className="btn btn-secondary"
              icon={Share2}
              label={pdfBusy ? 'Making the PDF…' : 'Share'}
              align="end"
              items={[
                { label: 'Download PDF', icon: FileDown, onSelect: download, disabled: pdfBusy },
                ...(pdf.sendNow
                  ? [{ label: 'Send on WhatsApp now', icon: Send, onSelect: () => setAsking(true), disabled: pdfBusy }]
                  : pdf.whatsapp
                    ? [{ label: 'Send on WhatsApp', icon: MessageCircle, href: pdf.whatsapp.href, onClick: sendWhatsApp }]
                    : []),
                ...(sharing && !failed ? [{ label: ready ? 'Share PDF…' : 'Preparing PDF…', icon: Share2, onSelect: share, disabled: !ready || pdfBusy }] : []),
              ]}
            />
          )}
          <button type="button" className="btn btn-link" onClick={onClose}>
            Close
          </button>
        </div>
        {asking && pdf?.sendNow && (
          <div className="pv-ask" role="alertdialog" aria-labelledby="pv-ask-title">
            <p id="pv-ask-title">
              <strong>Send this to {pdf.sendNow.label} on WhatsApp?</strong> It is the number on the patient’s record. It goes from the hospital’s WhatsApp number through WhatsApp’s (Meta’s)
              servers and cannot be taken back. Check that it is the right patient.
              {pdf.sendNow.practice ? ' Practice mode: nothing is really sent.' : ''}
            </p>
            <div className="row">
              <button type="button" className="btn btn-secondary btn-sm" onClick={sendNow} disabled={pdfBusy} autoFocus>
                <Send aria-hidden="true" /> {pdfBusy ? 'Sending…' : 'Send now'}
              </button>
              <button type="button" className="btn btn-link btn-sm" onClick={() => setAsking(false)} disabled={pdfBusy}>
                Don’t send
              </button>
            </div>
          </div>
        )}
        <Alert type="error">{error}</Alert>
        <Alert type="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      </div>
      {page && <style>{`@media print { @page { size: ${page.size ?? 'A4'}; margin: ${page.margin ?? '12mm'}; } }`}</style>}
      {/* "Page 1 of 2" in the page's bottom margin (a lab report – docs/LAB_TEMPLATES_PLAN.md); the PDF draws its own */}
      {pageNumbers && <style>{'@media print { @page { @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt sans-serif; color: #000; } } }'}</style>}
      <div
        ref={sheet}
        className={['pv-sheet', page?.size === 'A5' ? 'pv-sheet-a5' : '', FITS[fitted]].filter(Boolean).join(' ')}
        style={page?.margin ? { padding: page.margin } : undefined}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * One printed document. The Draft band (when `draft` is set) and the footer line are repeated at the top and
 * bottom of every printed page (browsers repeat a table's header and footer rows), so a loose page still says
 * whose it is and that it is a draft. footer null: no footer (e.g. on a doctor's own pre-printed pad).
 */
export function PrintDocument({ draft, footer, className = '', style, children }) {
  return (
    <div className={`pdoc ${className}`.trim()} style={style}>
      <table className="ptable pframe">
        {draft && (
          <thead>
            <tr>
              <td>
                <p className="pdoc-draft">
                  <TriangleAlert aria-hidden="true" /> {draft}
                </p>
              </td>
            </tr>
          </thead>
        )}
        {footer && (
          <tfoot>
            <tr>
              <td>
                <div className="pdoc-foot">{footer}</div>
              </td>
            </tr>
          </tfoot>
        )}
        <tbody>
          <tr>
            <td>{children}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Label / value pairs under the title (name, patient number, EDD …). items: [[label, value, wide?]]. */
export function PrintFacts({ items }) {
  return (
    <dl className="pdoc-facts">
      {items
        .filter(([, value]) => value !== undefined)
        .map(([label, value, wide]) => (
          <div key={typeof label === 'string' ? label : label.key} className={wide ? 'pdoc-wide' : undefined}>
            <dt>{label}</dt>
            <dd>{value === '' || value == null ? '—' : value}</dd>
          </div>
        ))}
    </dl>
  );
}
