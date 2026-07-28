# Stage 1: Build frontend
#
# The web SPA has its own package-lock and dependency tree (this repo is not an
# npm workspace), so its deps must be installed from web/ — a root `npm ci`
# does not provide them.
FROM node:22-alpine AS web-builder

WORKDIR /app/web

COPY web/package*.json ./
RUN npm ci

COPY web/ ./
RUN npm run build

# Stage 2: Build backend
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# Stage 3: Run
FROM node:22-alpine AS runner

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# bootstrap() in src/index.ts runs drizzle migrate with
# migrationsFolder: './src/db/migrations', resolved against the workdir — so the
# SQL files and their snapshot metadata must ship in the runtime image.
COPY src/db/migrations ./src/db/migrations

# createApp() in src/app.ts serves ./web/dist for every non-/api route.
COPY --from=web-builder /app/web/dist ./web/dist

EXPOSE 3000

CMD ["node", "dist/index.js"]
