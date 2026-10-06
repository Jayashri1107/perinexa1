import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config/index.js';
import { ACCESS } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/rateLimiters.js';
import { modules } from './modules/index.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', config.server.trustProxy);

  app.use(helmet());
  app.use(cors({ origin: config.client.url, credentials: true }));
  app.use(express.json({ limit: config.server.jsonLimit }));
  app.use(cookieParser());

  const api = express.Router();
  api.use(apiLimiter);
  for (const { path, access, router } of modules) {
    api.use(path, ...ACCESS[access], router);
  }
  app.use(config.server.apiPrefix, api);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
