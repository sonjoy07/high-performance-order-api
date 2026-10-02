# ── Build dependencies ────────────────────────────────────────────────────────
# Install ALL deps (dev too — we need prisma CLI, tsc, etc. to build)
FROM node:22-alpine AS deps
WORKDIR /app

# Install native build tools required for some native addons (e.g. pg)
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci

# ── TypeScript build ──────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma Client and compile TypeScript
RUN npx prisma generate
RUN npm run build

# ── Production runtime image ──────────────────────────────────────────────────
FROM node:22-alpine AS production
WORKDIR /app

ENV NODE_ENV=production

# Install only production-ready OS packages
RUN apk add --no-cache dumb-init

# Create a non-root user to run the application
RUN addgroup -g 1001 -S nodejs && \
    adduser  -u 1001 -S nodejs -G nodejs

# Copy production node_modules (re-install only prod deps for a lean image)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy compiled application
COPY --from=build /app/dist ./dist

# Copy Prisma schema & generated client (needed at runtime for migrations + queries)
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY prisma ./prisma
COPY prisma.config.ts ./

# Use the non-root user
USER nodejs

# Expose the application port (default 5000; overridden via PORT env var)
EXPOSE 5000

# Use dumb-init as PID 1 for proper signal forwarding and zombie reaping
ENTRYPOINT ["dumb-init", "--"]

# Default command: start the compiled API server
# Override with `command: node dist/worker.js` in docker-compose for the worker
CMD ["node", "dist/server.js"]
