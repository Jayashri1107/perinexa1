// A bill being made, kept while the pharmacist goes to another page of the app – Stock or Medicines, to add a medicine
// that was missing – and opened again as it was left when they come back to Sales bill or Issue to ward (18 Nov 2026,
// the pharmacy's request). Kept only in this page's memory, never in the browser's storage: it is gone when the page
// is reloaded, and it opens again only for the same person in the same hospital. One for a sale, one for an issue.

const drafts = new Map(); // kind ('sale' | 'issue') → { owner, ...the bill's fields }

/** Who a draft belongs to: the person signed in and the hospital they are working in. */
export const draftOwner = (user, tenantId) => `${user?.id ?? user?._id ?? ''}|${tenantId ?? ''}`;

export function saveDraft(kind, owner, fields) {
  drafts.set(kind, { owner, ...fields });
}

/** The draft of this kind for this owner, or null. */
export function findDraft(kind, owner) {
  const d = drafts.get(kind);
  return d && d.owner === owner ? d : null;
}

export function clearDraft(kind) {
  drafts.delete(kind);
}
