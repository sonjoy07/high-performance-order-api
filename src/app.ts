import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { requestLogger } from './common/middleware/request-logger.middleware';
import { errorHandler } from './common/middleware/error.middleware';
import { notFoundHandler } from './common/middleware/not-found.middleware';
import { healthRouter } from './modules/health/health.route';

export const createApp = (): Express => {
  const app = express();

  // Security & Utility Middleware
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // HTTP Request Logging
  app.use(requestLogger);

  // Application Routes
  app.use('/health', healthRouter);

  // 404 Not Found Middleware
  app.use(notFoundHandler);

  // Centralized Error Handling Middleware
  app.use(errorHandler);

  return app;
};

export const app = createApp();
