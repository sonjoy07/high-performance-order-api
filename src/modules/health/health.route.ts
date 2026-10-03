import { Router } from 'express';
import { HealthController } from './health.controller';

const router = Router();

/** GET /health — Lightweight liveness check (no dependency probes) */
router.get('/', HealthController.getHealth);

/** GET /ready — Readiness check (probes PostgreSQL + Redis) */
router.get('/ready', HealthController.getReady);

export const healthRouter = router;
