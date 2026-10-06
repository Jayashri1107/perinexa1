import { getOverview } from './hospitalOverview.service.js';

export async function get(req, res) {
  res.json(await getOverview(req.hospitalId));
}
