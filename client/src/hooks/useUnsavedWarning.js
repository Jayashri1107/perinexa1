import { useEffect } from 'react';

// Leaving a page with unsaved changes asks once (the owner's history-taking sheet, docs/HISTORY_SHEET_LAYOUT.md
// section 6): closing or reloading the tab gets the browser's own question; a click on a link inside Perinexa asks
// "Leave without saving?" first. Saving and going on (the app moving to the next page itself) never asks.

export const UNSAVED_MESSAGE = 'You have changes on this page that are not saved. Leave without saving?';

/** Is this click one that would leave for another page of Perinexa? */
export function leavesPage(event, here = window.location) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const a = event.target?.closest?.('a[href]');
  if (!a || a.target === '_blank' || a.hasAttribute('download')) return false;
  const url = new URL(a.getAttribute('href'), here.href);
  if (url.origin !== here.origin) return false;
  return url.pathname !== here.pathname || url.search !== here.search;
}

export function useUnsavedWarning(dirty, message = UNSAVED_MESSAGE) {
  useEffect(() => {
    if (!dirty) return undefined;
    const onUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    // Before the app's own link handling (capture, on the document): a "no" stops the link
    const onClick = (e) => {
      if (!leavesPage(e)) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, message]);
}
