import express, { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config/index.js';
import { objectId, optional, optionalText, parse } from '../../core/validate.js';
import { DOCUMENT_KIND_KEYS } from './medicalDocument.model.js';
import * as service from './document.service.js';

// Scanned and uploaded papers on a patient's record: config.access.patientDocuments; each request is checked again
// against her record (recordsAccess.js).
//  GET  /patient/:patientId        her documents (no files)
//  POST /patient/:patientId        upload one: the file is the body (application/octet-stream); what it is comes in
//                                  the X-Document-* headers (kept out of the address, so out of server logs)
//  GET  /:documentId/file          the file itself
//  POST /:documentId/cancel        mark as entered in error, with a reason
const router = Router();

const patientParams = z.object({ patientId: objectId });
const documentParams = z.object({ documentId: objectId });
const header = (req, name) => {
  const v = req.get(name);
  try {
    return v ? decodeURIComponent(v) : undefined;
  } catch {
    return v;
  }
};
const uploadMeta = z.object({
  kind: z.enum(DOCUMENT_KIND_KEYS, 'Choose what the document is'),
  title: optionalText(120),
  documentDate: optional(z.coerce.date().refine((d) => d <= new Date(), 'The date cannot be in the future')),
  admissionId: optional(objectId),
});
const cancelBody = z.object({ reason: z.string().trim().min(5, 'Write the reason (at least 5 characters)').max(300) });

const rawFile = express.raw({ type: 'application/octet-stream', limit: `${config.documents.maxMegabytes + 1}mb` });

router.get('/patient/:patientId', async (req, res) => {
  res.json(await service.listDocuments(req, parse(patientParams, req.params).patientId));
});

router.post('/patient/:patientId', rawFile, async (req, res) => {
  const { patientId } = parse(patientParams, req.params);
  const meta = parse(uploadMeta, {
    kind: header(req, 'X-Document-Kind'),
    title: header(req, 'X-Document-Title'),
    documentDate: header(req, 'X-Document-Date'),
    admissionId: header(req, 'X-Admission-Id'),
  });
  res.status(201).json(await service.uploadDocument(req, patientId, meta, req.body));
});

router.get('/:documentId/file', async (req, res) => {
  const { mimeType, file, fileName } = await service.documentFile(req, parse(documentParams, req.params).documentId);
  res.set({
    'Content-Type': mimeType,
    'Content-Disposition': `inline; filename="${fileName}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(file);
});

router.post('/:documentId/cancel', async (req, res) => {
  const { documentId } = parse(documentParams, req.params);
  res.json(await service.cancelDocument(req, documentId, parse(cancelBody, req.body).reason));
});

export default router;
