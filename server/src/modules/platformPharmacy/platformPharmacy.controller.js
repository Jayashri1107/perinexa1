import { platformPharmacy } from './platformPharmacy.service.js';

export async function summary(_req, res) {
  res.json(await platformPharmacy());
}
