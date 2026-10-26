import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import path from 'node:path';

import env from './config/env.js';
import apiRoutes from './routes/index.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';
import { generalLimiter } from './middleware/rateLimit.js';
import { handleWebhook } from './controllers/payment.controller.js';
import { UPLOAD_ROOT } from './services/storage.js';

const createApp = () => {
  const app = express();

  // Required for correct req.ip (and therefore rate limiting) behind a proxy.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // The API serves JSON and uploaded images; the SPA is served separately
      // in development, so cross-origin reads of images must be allowed.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: false,
    }),
  );

  app.use(
    cors({
      origin: env.clientOrigin.split(',').map((origin) => origin.trim()),
      credentials: true,
    }),
  );

  app.use(compression());
  app.use(cookieParser());

  if (env.isDev) app.use(morgan('dev'));

  /**
   * Webhooks are mounted BEFORE the JSON body parser and before any auth, for
   * two reasons: the signature must be computed over the exact raw bytes the
   * gateway signed, and a gateway carries no session of ours.
   */
  app.post(
    '/api/payments/webhook/:provider',
    express.raw({ type: '*/*', limit: '1mb' }),
    handleWebhook,
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Locally stored uploads. In production STORAGE_DRIVER=cloudinary serves
  // these from a CDN instead and this route goes unused.
  app.use(
    '/uploads',
    express.static(UPLOAD_ROOT, {
      maxAge: '7d',
      // Never execute or infer anything from an uploaded file.
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Disposition', 'inline');
      },
    }),
  );

  app.use('/api', generalLimiter, apiRoutes);

  // Serve the built SPA when it exists, so `npm run build` plus `npm start`
  // gives a single-origin production deployment.
  if (env.isProd) {
    const clientDist = path.resolve(process.cwd(), '../client/dist');
    app.use(express.static(clientDist, { maxAge: '1d', index: false }));
    app.get(/^\/(?!api|uploads).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return app;
};

export default createApp;
