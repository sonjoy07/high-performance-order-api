import { User, Customer, RefreshToken, UserRole } from '@prisma/client';
import { prisma } from '../../config/prisma';

export interface UserWithCustomer extends User {
  customer: Customer | null;
}

export interface RefreshTokenWithUser extends RefreshToken {
  user: User;
}

export class AuthRepository {
  /**
   * Finds a user by email, including linked customer record.
   */
  public async findUserByEmail(email: string): Promise<UserWithCustomer | null> {
    return prisma.user.findUnique({
      where: { email },
      include: { customer: true },
    });
  }

  /**
   * Finds a user by ID, including linked customer record.
   */
  public async findUserById(id: string): Promise<UserWithCustomer | null> {
    return prisma.user.findUnique({
      where: { id },
      include: { customer: true },
    });
  }

  /**
   * Creates a User with role CUSTOMER and linked Customer profile in a single transaction.
   * Public registration NEVER allows ADMIN accounts.
   */
  public async createCustomerUser(data: {
    email: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
    phone?: string;
  }): Promise<{ user: User; customer: Customer }> {
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: data.email,
          passwordHash: data.passwordHash,
          role: UserRole.CUSTOMER,
        },
      });

      const customer = await tx.customer.create({
        data: {
          userId: user.id,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone ?? null,
        },
      });

      return { user, customer };
    });
  }

  /**
   * Persists a hashed refresh token in the database.
   */
  public async createRefreshToken(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<RefreshToken> {
    return prisma.refreshToken.create({
      data: {
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
      },
    });
  }

  /**
   * Finds a refresh token by its SHA-256 hash, including the owner user.
   */
  public async findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenWithUser | null> {
    return prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
  }

  /**
   * Revokes a refresh token by setting its revokedAt timestamp.
   */
  public async revokeRefreshToken(tokenHash: string): Promise<RefreshToken | null> {
    const existing = await prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!existing) {
      return null;
    }

    return prisma.refreshToken.update({
      where: { tokenHash },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Rotates a refresh token in an atomic transaction: revokes the old token
   * and inserts the new hashed refresh token.
   */
  public async rotateRefreshToken(
    oldTokenHash: string,
    newTokenData: {
      userId: string;
      tokenHash: string;
      expiresAt: Date;
    }
  ): Promise<RefreshToken> {
    return prisma.$transaction(async (tx) => {
      await tx.refreshToken.update({
        where: { tokenHash: oldTokenHash },
        data: { revokedAt: new Date() },
      });

      return tx.refreshToken.create({
        data: {
          userId: newTokenData.userId,
          tokenHash: newTokenData.tokenHash,
          expiresAt: newTokenData.expiresAt,
        },
      });
    });
  }

  /**
   * Revokes all active refresh tokens for a user (e.g. security reset or logout from all devices).
   */
  public async revokeAllUserTokens(userId: string): Promise<number> {
    const result = await prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    return result.count;
  }
}
