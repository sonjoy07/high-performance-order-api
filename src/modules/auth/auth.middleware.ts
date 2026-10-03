import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';
import { AuthenticationError, AuthorizationError } from '../../common/errors/app.error';
import { verifyAccessToken } from './auth.utils';

/**
 * Middleware to authenticate requests via Bearer JWT Access Token.
 * Verifies token signature, expiration, and token type (must be 'access').
 * Sets req.user = { id: sub, role }.
 */
export const authenticate = (req: Request, _res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    throw new AuthenticationError('Authorization header is required');
  }

  const parts = authHeader.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer' || !parts[1]) {
    throw new AuthenticationError('Authorization header must use "Bearer <token>" format');
  }

  const token = parts[1];
  const payload = verifyAccessToken(token);

  req.user = {
    id: payload.sub,
    role: payload.role,
  };

  next();
};

/**
 * RBAC authorization middleware to restrict access by UserRole.
 * Rejects requests with 403 FORBIDDEN if the user's role is not allowed.
 */
export const requireRole = (...allowedRoles: UserRole[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new AuthenticationError('Authentication required');
    }

    if (!allowedRoles.includes(req.user.role)) {
      throw new AuthorizationError(`Access forbidden: required role ${allowedRoles.join(' or ')}`);
    }

    next();
  };
};
