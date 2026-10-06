import { getSummary } from './dashboard.service.js';

export async function summary(_req, res) {
  res.json(await getSummary());
}
