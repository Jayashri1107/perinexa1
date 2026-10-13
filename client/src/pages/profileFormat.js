// My profile (owner, 13 Oct 2026): small helpers – the department a role belongs to, this computer's browser and
// system, and the photo made smaller in the browser before it is saved.

const DEPARTMENTS = {
  admin: 'Administration',
  doctor: 'Medical',
  rmo: 'Medical',
  nurse: 'Nursing',
  receptionist: 'Reception',
  lab: 'Laboratory',
  pharmacist: 'Pharmacy',
  billing: 'Billing',
};

/** "Reception", or "Medical, Administration" for someone with several roles. */
export const departmentOf = (roles = []) => [...new Set(roles.map((r) => DEPARTMENTS[r]).filter(Boolean))].join(', ');

/** "Windows · Chrome" from a browser's user agent (nothing is sent anywhere: it describes this computer). */
export function deviceLabel(ua = '') {
  const os = /Windows/i.test(ua) ? 'Windows' : /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Mac OS X|Macintosh/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'This computer';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'a browser';
  return `${os} · ${browser}`;
}

/** The picture chosen, as a square JPEG of `size` pixels (a data URL) – small enough to keep with the account. */
export function squarePhoto(file, size = 256) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file?.type ?? '')) {
      reject(new Error('Choose a JPEG, PNG or WebP picture.'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      canvas.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This picture could not be opened.'));
    };
    img.src = url;
  });
}
