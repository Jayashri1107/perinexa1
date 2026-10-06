import { parse } from '../../core/validate.js';
import { recordAudit } from '../audit/audit.service.js';
import * as service from './billingReports.service.js';
import { dailyQuery, exportQuery, monthlyQuery, unpaidQuery } from './billingReports.validation.js';

export async function unpaid(req, res) {
  res.json(await service.unpaidBills(req.hospitalId, parse(unpaidQuery, req.query)));
}

export async function daily(req, res) {
  res.json(await service.dailySummary(req.hospitalId, parse(dailyQuery, req.query).date));
}

export async function monthly(req, res) {
  res.json(await service.monthlyIncome(req.hospitalId, parse(monthlyQuery, req.query).months));
}

export async function exportCsv(req, res) {
  const { from, to } = parse(exportQuery, req.query);
  const csv = await service.exportBills(req.hospitalId, from, to);
  await recordAudit(req, 'BILLS_EXPORTED', { hospitalId: req.hospitalId, details: { from, to } });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="bills-${from}-to-${to}.csv"`);
  res.send(`﻿${csv}`); // the BOM lets Excel read ₹ and Indian names correctly
}
