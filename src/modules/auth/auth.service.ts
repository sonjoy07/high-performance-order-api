import { AuthRepository } from './auth.repository';
import {
  RegisterInput,
  LoginInput,
  AuthTokens,
  RegisterResponseData,
  SafeUser,
} from './auth.types';
import {
  hashPassword,
  comparePassword,
  hashToken,
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  parseDurationToSeconds,
} from './auth.utils';
import {
  EmailAlreadyExistsError,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  RevokedRefreshTokenError,
  RefreshTokenExpiredError,
  UserNotFoundError,
} from '../../common/errors/app.error';
import { config } from '../../config/env';

// Dummy hash used for constant-time comparison when user is not found to thwart timing attacks
const DUMMY_HASH = '$2a$10$e8wZ3V1WnN.xM7Zf4n1qMeW28mQ5O0sA8A4L0iOqZcM7l1KkLwG7W';

export class AuthService {
  constructor(private readonly authRepository: AuthRepository) {}

  /**
   * Registers a new customer user and customer profile.
   * Public registration always assigns CUSTOMER role.
   */
  public async register(input: RegisterInput): Promise<RegisterResponseData> {
    const normalizedEmail = input.email.toLowerCase().trim();

    const existingUser = await this.authRepository.findUserByEmail(normalizedEmail);
    if (existingUser) {
      throw new EmailAlreadyExistsError(`User with email "${normalizedEmail}" already exists`);
    }

    const passwordHash = await hashPassword(input.password);
    const firstName = input.firstName?.trim() || 'Customer';
    const lastName = input.lastName?.trim() || 'User';

    const { user, customer } = await this.authRepository.createCustomerUser({
      email: normalizedEmail,
      passwordHash,
      firstName,
      lastName,
      phone: input.phone?.trim() || undefined,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
      },
      customer: {
        id: customer.id,
        firstName: customer.firstName,
        lastName: customer.lastName,
        phone: customer.phone,
      },
    };
  }

  /**
   * Authenticates user credentials and generates access + refresh tokens.
   */
  public async login(input: LoginInput): Promise<AuthTokens> {
    const normalizedEmail = input.email.toLowerCase().trim();

    const user = await this.authRepository.findUserByEmail(normalizedEmail);
    if (!user) {
      // Execute dummy compare to prevent timing side-channels
      await comparePassword(input.password, DUMMY_HASH);
      throw new InvalidCredentialsError('Invalid email or password');
    }

    const isMatch = await comparePassword(input.password, user.passwordHash);
    if (!isMatch) {
      throw new InvalidCredentialsError('Invalid email or password');
    }

    // 1. Generate Access Token (short-lived)
    const accessToken = generateAccessToken(user.id, user.role);

    // 2. Generate Refresh Token (long-lived)
    const refreshTokenData = generateRefreshToken(user.id);

    // 3. Store SHA-256 hashed refresh token in DB
    const tokenHash = hashToken(refreshTokenData.token);
    await this.authRepository.createRefreshToken({
      userId: user.id,
      tokenHash,
      expiresAt: refreshTokenData.expiresAt,
    });

    const expiresIn = parseDurationToSeconds(config.JWT_ACCESS_EXPIRES_IN);

    return {
      accessToken,
      refreshToken: refreshTokenData.token,
      tokenType: 'Bearer',
      expiresIn,
    };
  }

  /**
   * Refreshes an access token using a valid refresh token.
   * Rotates the refresh token (revokes old token, issues new token).
   * Prevents reuse of revoked tokens.
   */
  public async refreshToken(refreshTokenStr: string): Promise<AuthTokens> {
    // 1. Verify JWT signature & structure
    verifyRefreshToken(refreshTokenStr);

    // 2. Hash token to look up database session
    const tokenHash = hashToken(refreshTokenStr);
    const tokenRecord = await this.authRepository.findRefreshTokenByHash(tokenHash);

    if (!tokenRecord) {
      throw new InvalidRefreshTokenError('Invalid refresh token');
    }

    // 3. Check revocation (Reuse detection)
    if (tokenRecord.revokedAt !== null) {
      throw new RevokedRefreshTokenError(
        'Refresh token has been revoked. Re-authentication required.'
      );
    }

    // 4. Check expiration in DB
    if (tokenRecord.expiresAt < new Date()) {
      throw new RefreshTokenExpiredError('Refresh token has expired');
    }

    // 5. Verify user still exists
    const user = await this.authRepository.findUserById(tokenRecord.userId);
    if (!user) {
      throw new UserNotFoundError('User account no longer exists');
    }

    // 6. Generate new token pair
    const newAccessToken = generateAccessToken(user.id, user.role);
    const newRefreshTokenData = generateRefreshToken(user.id);
    const newTokenHash = hashToken(newRefreshTokenData.token);

    // 7. Atomically rotate: revoke old token and create new token
    await this.authRepository.rotateRefreshToken(tokenHash, {
      userId: user.id,
      tokenHash: newTokenHash,
      expiresAt: newRefreshTokenData.expiresAt,
    });

    const expiresIn = parseDurationToSeconds(config.JWT_ACCESS_EXPIRES_IN);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshTokenData.token,
      tokenType: 'Bearer',
      expiresIn,
    };
  }

  /**
   * Revokes the provided refresh token.
   */
  public async logout(userId: string, refreshTokenStr: string): Promise<void> {
    const tokenHash = hashToken(refreshTokenStr);
    const tokenRecord = await this.authRepository.findRefreshTokenByHash(tokenHash);

    if (tokenRecord && tokenRecord.userId === userId) {
      await this.authRepository.revokeRefreshToken(tokenHash);
    }
  }

  /**
   * Returns authenticated user profile and customer information safely.
   */
  public async getMe(userId: string): Promise<SafeUser> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) {
      throw new UserNotFoundError('User not found');
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      customer: user.customer
        ? {
            id: user.customer.id,
            firstName: user.customer.firstName,
            lastName: user.customer.lastName,
            phone: user.customer.phone,
          }
        : null,
    };
  }
}
