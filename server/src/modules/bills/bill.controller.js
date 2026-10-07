import { parse } from '../../core/validate.js';
import { pickPatients } from '../patients/patient.service.js';
import * as service from './bill.service.js';
import {
  addLinesBody,
  billListQuery,
  billParams,
  cancelBody,
  createBillBody,
  discountBody,
  lineParams,
  patientSearchQuery,
  paymentBody,
  refundBody,
  lineUpdateBody,
} from './bill.validation.js';

export async function list(req, res) {
  res.json(await service.listBills(req.hospitalId, parse(billListQuery, req.query)));
}

export async function patients(req, res) {
  res.json({ items: await pickPatients(req.hospitalId, parse(patientSearchQuery, req.query).search) });
}

export async function create(req, res) {
  res.status(201).json(await service.createBill(req, parse(createBillBody, req.body)));
}

export async function get(req, res) {
  const { id } = parse(billParams, req.params);
  res.json(await service.getBill(req.hospitalId, id));
}

export async function addLines(req, res) {
  const { id } = parse(billParams, req.params);
  res.json(await service.addLines(req, id, parse(addLinesBody, req.body).lines));
}

export async function removeLine(req, res) {
  const { id, lineId } = parse(lineParams, req.params);
  res.json(await service.removeLine(req, id, lineId));
}

export async function discount(req, res) {
  const { id } = parse(billParams, req.params);
  res.json(await service.setDiscount(req, id, parse(discountBody, req.body)));
}

export async function cancel(req, res) {
  const { id } = parse(billParams, req.params);
  res.json(await service.cancelBill(req, id, parse(cancelBody, req.body).reason));
}

export async function payment(req, res) {
  const { id } = parse(billParams, req.params);
  res.json(await service.takePayment(req, id, parse(paymentBody, req.body)));
}

export async function refund(req, res) {
  const { id } = parse(billParams, req.params);
  res.json(await service.giveRefund(req, id, parse(refundBody, req.body)));
}

export async function updateLine(req, res) {
  const { id, lineId } = parse(lineParams, req.params);
  res.json(await service.updateLine(req, id, lineId, parse(lineUpdateBody, req.body)));
}
