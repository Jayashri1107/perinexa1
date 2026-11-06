// The Android app prints and saves through window.PerinexaApp; a browser goes on using its own print and download.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { printPage, saveInAndroidApp, savedNote, savedPlace } from './androidApp.js';
import { downloadFile } from '../components/print/pdfExport.js';

// Just enough of a browser: these tests run without one
class SampleFileReader {
  readAsDataURL(blob) {
    blob.arrayBuffer().then((bytes) => {
      this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;
      this.onload();
    });
  }
}

let print;
let createElement;

beforeEach(() => {
  print = vi.fn();
  createElement = vi.fn();
  vi.stubGlobal('window', { print });
  vi.stubGlobal('document', { title: 'Perinexa', createElement });
  vi.stubGlobal('FileReader', SampleFileReader);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('in a browser', () => {
  it('prints with the browser', () => {
    printPage();
    expect(print).toHaveBeenCalledOnce();
  });

  it('leaves saving to the browser', () => {
    expect(saveInAndroidApp(new Blob(['x']), 'x.pdf')).toBe(false);
  });

  it('says the file is in the Downloads folder', () => {
    expect(savedNote('x.pdf')).toBe('Saved as “x.pdf” in your Downloads folder.');
    expect(savedPlace()).toBe('your Downloads folder');
  });
});

describe('in the Android app', () => {
  it('prints through the app, not the browser', () => {
    const app = { print: vi.fn() };
    vi.stubGlobal('PerinexaApp', app);
    printPage();
    expect(app.print).toHaveBeenCalledWith('Perinexa');
    expect(print).not.toHaveBeenCalled();
  });

  it('downloadFile hands the file over whole, with its name and type, and clicks no link', async () => {
    const saved = new Promise((resolve) => {
      vi.stubGlobal('PerinexaApp', { saveFile: (...args) => resolve(args) });
    });
    downloadFile(new Blob(['%PDF sample'], { type: 'application/pdf' }), 'sample.pdf');
    const [base64, name, type] = await saved;
    expect(Buffer.from(base64, 'base64').toString()).toBe('%PDF sample');
    expect(name).toBe('sample.pdf');
    expect(type).toBe('application/pdf');
    expect(createElement).not.toHaveBeenCalled();
  });

  it('the words about a saved file do not promise the Downloads folder, or that it is already saved', () => {
    vi.stubGlobal('PerinexaApp', { saveFile: vi.fn() });
    expect(savedNote('x.pdf')).toBe('Choose where to save “x.pdf”.');
    expect(savedPlace()).toBe('where you saved it');
  });
});

describe('the shell', () => {
  const shell = (f) => readFileSync(new URL(`../../../mobile/android/app/src/main/${f}`, import.meta.url), 'utf8');

  it('asks for the camera and microphone, without making them necessary to install', () => {
    const manifest = shell('AndroidManifest.xml');
    expect(manifest).toContain('android.permission.CAMERA');
    expect(manifest).toContain('android.permission.RECORD_AUDIO');
    expect(manifest).toContain('android:name="android.hardware.camera" android:required="false"');
  });

  it('keeps the app out of phone backups and transfers', () => {
    expect(shell('AndroidManifest.xml')).toContain('android:allowBackup="false"');
    const rules = shell('res/xml/data_extraction_rules.xml');
    expect(rules).toContain('<cloud-backup>');
    expect(rules).toContain('<device-transfer>');
    expect(rules).not.toContain('<include');
  });

  it("keeps the screens' own text size whatever the phone's font size", () => {
    const activity = readFileSync(new URL('../../../mobile/android/app/src/main/java/com/perinexa/app/MainActivity.java', import.meta.url), 'utf8');
    expect(activity).toContain('setTextZoom(100)');
  });
});
