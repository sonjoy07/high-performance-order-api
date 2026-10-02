import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
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

  // Security & Utility Middleware
  app.set('trust proxy', 1);
  app.use(helmet());
  const corsOrigins = config.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  app.use(
    cors({
      origin: corsOrigins.length > 1 ? corsOrigins : corsOrigins[0] || '*',
      credentials: true,
    })
  );
  app.use(express.json({ limit: config.BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: config.BODY_LIMIT }));

  // HTTP Request Logging
  app.use(requestLogger);

  // API Documentation
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  // Application Routes
  app.use('/health', healthRouter);
  app.use('/api/v1/auth', authRateLimiter, authRouter);
  app.use('/api/v1/categories', globalRateLimiter, categoryRouter);
  app.use('/api/v1/products', globalRateLimiter, productRouter);
  app.use('/api/v1/inventory', globalRateLimiter, inventoryRouter);
  app.use('/api/v1/orders', globalRateLimiter, orderRouter);
  app.use('/api/v1/reports', globalRateLimiter, reportRouter);

  // 404 Not Found Middleware
  app.use(notFoundHandler);

  // Centralized Error Handling Middleware
  app.use(errorHandler);

  return app;
};

export const app = createApp();
