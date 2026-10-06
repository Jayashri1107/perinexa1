import { today } from './today.service.js';

export async function get(req, res) {
  res.json(await today(req));
}
