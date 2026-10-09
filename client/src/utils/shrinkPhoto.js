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
