// The pharmacy store's heading on every pharmacy paper (13 Nov 2026: the same name block on all of them): the store's
// name, address and mobile numbers, then its GSTIN and drug licences – from Pharmacy → Settings (the server falls back
// to the hospital's letterhead for an empty field). Used by the bills, orders, debit notes, registers and reports, and
// on top of a pharmacy screen printed with the browser's Print.
export function StoreHead({ settings, rmi = false }) {
  const ids = [settings.gstin && `GSTIN: ${settings.gstin}`, settings.licence20 && `DL 20: ${settings.licence20}`, settings.licence21 && `DL 21: ${settings.licence21}`, rmi && settings.rmi && `RMI: ${settings.rmi}`].filter(Boolean);
  return (
    <header className="ph-doc-head">
      <div className="lh-name">{settings.name}</div>
      {settings.address && <div className="ph-doc-address">{settings.address}</div>}
      {settings.phone && <div>Mobile No. {settings.phone}</div>}
      {ids.length > 0 && <div className="pdoc-small ph-doc-ids">{ids.join(' · ')}</div>}
    </header>
  );
}
