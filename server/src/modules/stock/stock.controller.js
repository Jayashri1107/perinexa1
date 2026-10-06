import { parse } from '../../core/validate.js';
import * as service from './stock.service.js';
import { adjustBody, batchParams, medicineParams, stockListQuery } from './stock.validation.js';

export async function list(req, res) {
  res.json(await service.listStock(req.hospitalId, parse(stockListQuery, req.query)));
}

export async function batches(req, res) {
  const { medicineId } = parse(medicineParams, req.params);
  res.json(await service.listBatches(req.hospitalId, medicineId));
}

export async function adjust(req, res) {
  const { batchId } = parse(batchParams, req.params);
  res.json({ batch: await service.adjustBatch(req, batchId, parse(adjustBody, req.body)) });
}
