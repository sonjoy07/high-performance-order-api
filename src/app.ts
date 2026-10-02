import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { randomUUID } from 'crypto';
import { requestLogger } from './common/middleware/request-logger.middleware';
import { errorHandler } from './common/middleware/error.middleware';
import { notFoundHandler } from './common/middleware/not-found.middleware';
import { healthRouter } from './modules/health/health.route';
import { categoryRouter } from './modules/categories/category.route';
import { productRouter } from './modules/products/product.route';
import { inventoryRouter } from './modules/inventory/inventory.route';
import { orderRouter } from './modules/orders/order.route';
import { reportRouter } from './modules/reports/report.route';
import { authRouter } from './modules/auth/auth.route';
import {
  globalRateLimiter,
  authRateLimiter,
} from './common/middleware/rate-limit.middleware';
import { config } from './config/env';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger';

export const createApp = (): Express => {
  const app = express();

  // Trust first proxy hop (needed for rate limiting and IP extraction behind load balancers)
  app.set('trust proxy', 1);

  // ── Request ID ─────────────────────────────────────────────────────────────
  // Every request gets a unique ID for log correlation.
  // Accepts X-Request-ID from trusted upstream (max 64 chars, alphanumeric+dash only).
  // Generates a UUID v4 if none is provided or if the header is invalid.
  app.use((req: Request, res: Response, next: NextFunction): void => {
    const incoming = req.headers['x-request-id'];
    const requestId =
      typeof incoming === 'string' && /^[a-zA-Z0-9\-]{1,64}$/.test(incoming)
        ? incoming
        : randomUUID();
    req.headers['x-request-id'] = requestId;
    res.setHeader('X-Request-ID', requestId);
    next();
  });

  // ── Security Headers ───────────────────────────────────────────────────────
  app.use(helmet());

  // ── CORS ───────────────────────────────────────────────────────────────────
  const corsOrigins = config.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  app.use(
    cors({
      origin: corsOrigins.length > 1 ? corsOrigins : corsOrigins[0] || '*',
      credentials: true,
    })
  );

  // ── Body Parsing ───────────────────────────────────────────────────────────
  app.use(express.json({ limit: config.BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: config.BODY_LIMIT }));

  // ── HTTP Request Logging ───────────────────────────────────────────────────
  app.use(requestLogger);

  // ── API Documentation ──────────────────────────────────────────────────────
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  // ── Health / Readiness (no rate limiting — used by load balancers) ─────────
  app.use('/health', healthRouter);

  // ── Application Routes ─────────────────────────────────────────────────────
  app.use('/api/v1/auth', authRateLimiter, authRouter);
  app.use('/api/v1/categories', globalRateLimiter, categoryRouter);
  app.use('/api/v1/products', globalRateLimiter, productRouter);
  app.use('/api/v1/inventory', globalRateLimiter, inventoryRouter);
  app.use('/api/v1/orders', globalRateLimiter, orderRouter);
  app.use('/api/v1/reports', globalRateLimiter, reportRouter);

  // ── 404 and Error Handlers ─────────────────────────────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

export const app = createApp();
