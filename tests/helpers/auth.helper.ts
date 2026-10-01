import { UserRole, User, Customer } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma } from '../../src/config/prisma';
import { generateAccessToken, generateRefreshToken } from '../../src/modules/auth/auth.utils';

export interface TestAuthUser {
  user: User;
  customer?: Customer | null;
  accessToken: string;
}

export const createTestAdmin = async (): Promise<TestAuthUser> => {
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash('AdminTest123!', salt);

  const user = await prisma.user.create({
    data: {
      email: `admin-test-${Date.now()}-${Math.random().toString(36).substring(7)}@orderapi.com`,
      passwordHash,
      role: UserRole.ADMIN,
    },
  });

  const accessToken = generateAccessToken(user.id, user.role);

  return { user, accessToken };
};

export const createTestCustomer = async (): Promise<TestAuthUser & { customer: Customer }> => {
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash('CustomerTest123!', salt);

  const user = await prisma.user.create({
    data: {
      email: `customer-test-${Date.now()}-${Math.random().toString(36).substring(7)}@example.com`,
      passwordHash,
      role: UserRole.CUSTOMER,
      customer: {
        create: {
          firstName: 'Test',
          lastName: 'Customer',
          phone: '+1-555-1234',
        },
      },
    },
    include: { customer: true },
  });

  const accessToken = generateAccessToken(user.id, user.role);

  return { user, customer: user.customer!, accessToken };
};

export const getTestTokens = (userId: string, role: UserRole) => {
  const accessToken = generateAccessToken(userId, role);
  const refreshTokenData = generateRefreshToken(userId);

  return {
    accessToken,
    refreshToken: refreshTokenData.token,
    refreshTokenId: refreshTokenData.tokenId,
    expiresAt: refreshTokenData.expiresAt,
  };
};
