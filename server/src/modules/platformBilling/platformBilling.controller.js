import { platformBilling } from './platformBilling.service.js';

export async function summary(_req, res) {
  res.json(await platformBilling());
}
