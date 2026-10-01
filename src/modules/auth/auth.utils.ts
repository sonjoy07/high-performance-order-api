import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { UserRole } from '@prisma/client';
import { config } from '../../config/env';
import { AccessTokenPayload, RefreshTokenPayload } from './auth.types';
import {
  AccessTokenExpiredError,
  InvalidAccessTokenError,
  RefreshTokenExpiredError,
  InvalidRefreshTokenError,
} from '../../common/errors/app.error';

/**
 * Parses duration strings like '15m', '7d', '1h' into seconds.
 */
export const parseDurationToSeconds = (duration: string): number => {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match || !match[1] || !match[2]) {
    const parsed = parseInt(duration, 10);
    return isNaN(parsed) ? 900 : parsed;
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's':
      return value;
    case 'm':
      return value * 60;
    case 'h':
      return value * 3600;
    case 'd':
      return value * 86400;
    default:
      return 900;
  }
};

/**
 * Calculates expiration Date given duration string (e.g. '7d', '15m').
 */
export const calculateExpiresAt = (duration: string): Date => {
  const seconds = parseDurationToSeconds(duration);
  return new Date(Date.now() + seconds * 1000);
};

/**
 * Hashes a plain password using bcrypt with 10 salt rounds.
 */
export const hashPassword = async (password: string): Promise<string> => {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
};

/**
 * Compares a plain password against a bcrypt hash.
 */
export const comparePassword = async (password: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};

/**
 * Deterministically hashes a token using SHA-256 for secure database storage.
 * Raw refresh tokens are never persisted in plain text.
 */
export const hashToken = (token: string): string => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

/**
 * Signs a short-lived access JWT token.
 */
export const generateAccessToken = (userId: string, role: UserRole): string => {
  const payload: AccessTokenPayload = {
    sub: userId,
    role,
    type: 'access',
  };

  return jwt.sign(payload, config.JWT_ACCESS_SECRET, {
    expiresIn: config.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
};

/**
 * Generates a signed refresh JWT token and returns token metadata.
 */
export const generateRefreshToken = (
  userId: string
): { token: string; tokenId: string; expiresAt: Date } => {
  const tokenId = crypto.randomUUID();
  const payload: RefreshTokenPayload = {
    sub: userId,
    tokenId,
    type: 'refresh',
  };

  const token = jwt.sign(payload, config.JWT_REFRESH_SECRET, {
    expiresIn: config.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });

  const expiresAt = calculateExpiresAt(config.JWT_REFRESH_EXPIRES_IN);

  return { token, tokenId, expiresAt };
};

/**
 * Verifies and decodes an access token.
 */
export const verifyAccessToken = (token: string): AccessTokenPayload => {
  try {
    const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET) as AccessTokenPayload;
    if (decoded.type !== 'access') {
      throw new InvalidAccessTokenError('Invalid token type: expected access token');
    }
    return decoded;
  } catch (error) {
    if (error instanceof InvalidAccessTokenError) {
      throw error;
    }
    if (error instanceof jwt.TokenExpiredError) {
      throw new AccessTokenExpiredError('Access token has expired');
    }
    throw new InvalidAccessTokenError('Invalid or malformed access token');
  }
};

/**
 * Verifies and decodes a refresh token.
 */
export const verifyRefreshToken = (token: string): RefreshTokenPayload => {
  try {
    const decoded = jwt.verify(token, config.JWT_REFRESH_SECRET) as RefreshTokenPayload;
    if (decoded.type !== 'refresh') {
      throw new InvalidRefreshTokenError('Invalid token type: expected refresh token');
    }
    return decoded;
  } catch (error) {
    if (error instanceof InvalidRefreshTokenError) {
      throw error;
    }
    if (error instanceof jwt.TokenExpiredError) {
      throw new RefreshTokenExpiredError('Refresh token has expired');
    }
    throw new InvalidRefreshTokenError('Invalid or malformed refresh token');
  }
};
