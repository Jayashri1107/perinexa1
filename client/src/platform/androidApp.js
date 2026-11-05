// The Android app (mobile/android/.../MainActivity.java) cannot print or download the browser's way, so it gives the
// website window.PerinexaApp to do it. In a browser, and in the iPhone app, that is absent and nothing changes here.

const androidApp = () => globalThis.PerinexaApp;

/** Prints the page: Android's print screen in the app, the browser's everywhere else. */
export function printPage() {
  if (androidApp()?.print) androidApp().print(document.title);
  else window.print();
}

/** What to tell the person once a file is on its way: the app is still asking where to save it, and they may cancel. */
export const savedNote = (fileName) => (androidApp()?.saveFile ? `Choose where to save “${fileName}”.` : `Saved as “${fileName}” in your Downloads folder.`);

/** Where the person finds a file they have just saved. */
export const savedPlace = () => (androidApp()?.saveFile ? 'where you saved it' : 'your Downloads folder');

/** In the Android app: asks where to save the file and returns true. Elsewhere: false, the browser downloads it. */
export function saveInAndroidApp(blob, fileName) {
  if (!androidApp()?.saveFile) return false;
  const reader = new FileReader();
  reader.onload = () => androidApp().saveFile(String(reader.result).split(',')[1] ?? '', fileName, blob.type);
  reader.readAsDataURL(blob);
  return true;
}
