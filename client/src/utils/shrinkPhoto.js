// A chosen picture as a small square JPEG (the middle of it, 256 × 256), as a data URL – about 20–60 KB, so it is quick
// to send and to show. Lower quality steps until it fits.
export async function shrinkPhoto(file, size = 256, maxChars = 90_000) {
  if (!file.type.startsWith('image/')) throw new Error('Choose a photo (JPEG, PNG or WebP).');
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('This file could not be read as a photo. Choose a JPEG or PNG.');
  });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close?.();
  for (const quality of [0.86, 0.75, 0.6, 0.45]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.length <= maxChars) return url;
  }
  throw new Error('This photo could not be made small enough. Choose another one.');
}

// A hospital logo for printed papers (owner, 9 Oct 2026): its shape kept, at most 360 × 360, as PNG (a transparent
// background stays transparent); a very detailed one becomes a JPEG on white to stay small.
export async function shrinkLogo(file, max = 360, maxChars = 400_000) {
  if (!file.type.startsWith('image/')) throw new Error('Choose a picture (PNG, JPEG or WebP).');
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('This file could not be read as a picture. Choose a PNG or JPEG.');
  });
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const png = canvas.toDataURL('image/png');
  if (png.length <= maxChars) return png;
  const flat = document.createElement('canvas');
  flat.width = canvas.width;
  flat.height = canvas.height;
  const f = flat.getContext('2d');
  f.fillStyle = '#ffffff';
  f.fillRect(0, 0, flat.width, flat.height);
  f.drawImage(canvas, 0, 0);
  for (const quality of [0.9, 0.8, 0.65]) {
    const url = flat.toDataURL('image/jpeg', quality);
    if (url.length <= maxChars) return url;
  }
  throw new Error('This logo could not be made small enough. Choose a simpler picture.');
}
