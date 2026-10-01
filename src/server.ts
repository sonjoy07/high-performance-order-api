import { app } from './app';
import { config } from './config/env';
import { logger } from './common/logger/logger';

const server = app.listen(config.PORT, () => {
  logger.info(`🚀 Server running in ${config.NODE_ENV} mode on port ${config.PORT}`);
  logger.info(`🏥 Health check available at http://localhost:${config.PORT}/health`);
});

// Graceful shutdown handling
const shutdown = (signal: string) => {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  server.close((err) => {
    if (err) {
      logger.error({ err }, 'Error during server close');
      process.exit(1);
    }
    logger.info('HTTP server closed successfully');
    process.exit(0);
  });

  // Force close after 10s timeout
  setTimeout(() => {
    logger.error('Forced shutdown due to timeout');
    process.exit(1);
  }, 10000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled Rejection detected');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught Exception detected. Process terminating.');
  process.exit(1);
});
