import { UserRole } from '@prisma/client';

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  type: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  tokenId: string;
  type: 'refresh';
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

export interface RegisterInput {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RefreshInput {
  refreshToken: string;
}

export interface LogoutInput {
  refreshToken: string;
}

export interface SafeCustomer {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
}

export interface SafeUser {
  id: string;
  email: string;
  role: UserRole;
  createdAt: Date;
  customer?: SafeCustomer | null;
}

export interface RegisterResponseData {
  user: {
    id: string;
    email: string;
    role: UserRole;
    createdAt: Date;
  };
  customer: SafeCustomer;
}
