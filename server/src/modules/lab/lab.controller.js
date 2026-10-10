import { parse } from '../../core/validate.js';
import * as service from './lab.service.js';
import { cancelBody, idParams, orderBody, orderListQuery, patientParams, queryBody, resultsBody } from './lab.validation.js';

const idOf = (req) => parse(idParams, req.params).id;

export async function catalogue(req, res) {
  res.json(await service.catalogue(req));
}

export async function list(req, res) {
  res.json(await service.listOrders(req, parse(orderListQuery, req.query)));
}

export async function forPatient(req, res) {
  res.json(await service.forPatient(req, parse(patientParams, req.params).patientId));
}

export async function get(req, res) {
  res.json(await service.getOrder(req, idOf(req)));
}

export async function printReport(req, res) {
  res.json(await service.printReport(req, idOf(req)));
}

export async function create(req, res) {
  res.status(201).json(await service.createOrder(req, parse(orderBody, req.body)));
}

export async function bookingCatalogue(req, res) {
  res.json(await service.bookingCatalogue(req));
}

export async function book(req, res) {
  res.status(201).json(await service.bookByReception(req, parse(orderBody, req.body)));
}

export async function collect(req, res) {
  res.json(await service.collect(req, idOf(req)));
}

export async function results(req, res) {
  res.json(await service.saveResults(req, idOf(req), parse(resultsBody, req.body)));
}

export async function review(req, res) {
  res.json(await service.review(req, idOf(req)));
}

export async function cancel(req, res) {
  res.json(await service.cancel(req, idOf(req), parse(cancelBody, req.body).reason));
}

export async function dashboard(req, res) {
  res.json(await service.dashboard(req));
}

export async function receive(req, res) {
  res.json(await service.receive(req, idOf(req)));
}

export async function process(req, res) {
  res.json(await service.startProcessing(req, idOf(req)));
}

export async function reject(req, res) {
  res.json(await service.rejectSample(req, idOf(req), parse(cancelBody, req.body).reason));
}

export async function query(req, res) {
  res.json(await service.askDoctor(req, idOf(req), parse(queryBody, req.body).text));
}
