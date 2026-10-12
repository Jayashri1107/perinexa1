// Attaching a file to a record (Version 2: lab reports, scanned consent forms): a PDF or a photo of at most 5 MB,
// sent as base64 (the server checks the file itself too – server/src/utils/storedFiles.js).

export const FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export const fileSize = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Why this file can't be attached ('' when it can). */
export function fileProblem(file) {
  if (!FILE_TYPES.includes(file.type)) return 'Choose a PDF or a photo (JPEG, PNG or WebP).';
  if (file.size > MAX_FILE_BYTES) return 'The file is too large (at most 5 MB).';
  return '';
}

/** A chosen file as base64 (without the "data:…;base64," start), for the upload. */
export function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new Error("The file couldn't be read."));
    reader.readAsDataURL(file);
  });
}

/** The request body for a file. */
export async function fileBody(file, extra = {}) {
  return { fileName: file.name, mediaType: file.type, data: await readAsBase64(file), ...extra };
}
