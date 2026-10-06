import { parse } from '../../core/validate.js';
import { hospitalAnalytics } from './analytics.service.js';
import { summaryQuery } from './analytics.validation.js';

export async function summary(req, res) {
  const { mine } = parse(summaryQuery, req.query);
  res.json(await hospitalAnalytics(req, { mine: mine === 'true' }));
}
