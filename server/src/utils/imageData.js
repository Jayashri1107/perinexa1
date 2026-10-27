// A small picture sent as a data: address (a signature, the hospital's logo): PNG or JPEG only, checked from its first
// bytes – not from what it says it is – and at most maxBytes. '' stays ''; anything else not allowed gives null.
export function checkedImage(data, maxBytes) {
  if (!data) return '';
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(data);
  if (!m) return null;
  const bytes = Buffer.from(m[2], 'base64');
  if (!bytes.length || bytes.length > maxBytes) return null;
  const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return (m[1] === 'png' && png) || (m[1] === 'jpeg' && jpeg) ? data : null;
}
