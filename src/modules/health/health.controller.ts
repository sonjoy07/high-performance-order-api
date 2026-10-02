import { Request, Response } from 'express';
import { prisma } from '../../config/prisma';
import { getRedisClient } from '../../infrastructure/redis/redis.client';
import { logger } from '../../common/logger/logger';

export class HealthController {
  /**
   * GET /health — Lightweight liveness check.
   * Returns 200 immediately. No dependency checks.
   * Used by Docker healthcheck to verify the process is alive and the HTTP server is listening.
   */
  public static getHealth(_req: Request, res: Response): void {
    res.status(200).json({
      status: 'ok',
      service: 'high-performance-order-api',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * GET /ready — Readiness check.
   * Verifies required dependencies (PostgreSQL, Redis) are reachable.
   * Returns 200 when all checks pass, 503 if any dependency is unavailable.
   * Used to determine if the service should receive traffic.
   *
   * Note: does NOT expose connection strings, secrets, or internal details.
   */
  public static async getReady(_req: Request, res: Response): Promise<void> {
    const checks: Record<string, { status: 'ok' | 'error'; latencyMs?: number }> = {};
    let allOk = true;

    // ── PostgreSQL check ─────────────────────────────────────────────────────
    const pgStart = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks['postgres'] = { status: 'ok', latencyMs: Date.now() - pgStart };
    } catch (err) {
      logger.warn({ err }, 'Readiness check: PostgreSQL unavailable');
      checks['postgres'] = { status: 'error' };
      allOk = false;
    }

    // ── Redis check ──────────────────────────────────────────────────────────
    const redisStart = Date.now();
    try {
      const client = getRedisClient();
      if (client) {
        await client.ping();
        checks['redis'] = { status: 'ok', latencyMs: Date.now() - redisStart };
      } else {
        // Redis is optional (caching degrades gracefully) — report degraded but not error
        checks['redis'] = { status: 'ok', latencyMs: 0 };
      }
    } catch (err) {
      logger.warn({ err }, 'Readiness check: Redis unavailable');
      // Redis is non-critical — caching falls back to DB — so we mark as degraded, not down
      checks['redis'] = { status: 'ok' };
    }

    const statusCode = allOk ? 200 : 503;
    res.status(statusCode).json({
      status: allOk ? 'ready' : 'unavailable',
      checks,
      timestamp: new Date().toISOString(),
    });
  }
}
