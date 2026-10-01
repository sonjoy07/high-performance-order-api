import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from './env';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const createPrismaClient = (): PrismaClient => {
  const adapter = new PrismaPg({
    connectionString: config.DATABASE_URL,
  });

  return new PrismaClient({
    adapter,
    log: config.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
  });
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (config.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
