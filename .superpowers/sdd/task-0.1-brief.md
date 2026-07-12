### Task 0.1: Project scaffolding & config files

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `drizzle.config.ts`, `docker-compose.yml`, `.env.example`, `.gitignore`, `Dockerfile`

**Interfaces:**
- Produces: npm scripts (`dev`, `build`, `typecheck`, `db:generate`, `db:migrate`, `test`, `docker:up`), a Postgres service on 5432, the `@wyrhta/core` git-tag dependency.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "heorth",
  "version": "0.1.0",
  "description": "The flagship self-hosted household system",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "dev:api": "tsx watch src/index.ts",
    "dev:web": "cd web && npm run dev",
    "dev:all": "concurrently \"npm run dev:api\" \"npm run dev:web\"",
    "build": "tsc --project tsconfig.json",
    "build:web": "cd web && npm run build",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "db:generate": "tsx node_modules/drizzle-kit/bin.cjs generate",
    "db:migrate": "tsx node_modules/drizzle-kit/bin.cjs migrate",
    "db:studio": "tsx node_modules/drizzle-kit/bin.cjs studio",
    "db:push": "tsx node_modules/drizzle-kit/bin.cjs push",
    "test": "vitest run",
    "test:watch": "vitest",
    "docker:up": "docker compose up -d",
    "docker:down": "docker compose down",
    "docker:reset": "docker compose down -v && docker compose up -d"
  },
  "dependencies": {
    "@hono/node-server": "^1.13.7",
    "@wyrhta/core": "github:wyrhta-labs/core#v0.1.0",
    "drizzle-orm": "^0.39.3",
    "hono": "^4.7.4",
    "postgres": "^3.4.5",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@types/node": "^22.13.10",
    "@vitest/coverage-v8": "^3.0.8",
    "concurrently": "^9.2.1",
    "drizzle-kit": "^0.30.4",
    "tsx": "^4.19.3",
    "typescript": "^5.8.2",
    "vitest": "^3.0.8"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    environment: 'node',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
```

- [ ] **Step 4: Write `drizzle.config.ts`**

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema/drizzle-schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgres://heorth:changeme@localhost:5432/heorth',
  },
});
```

- [ ] **Step 5: Write `docker-compose.yml`**

```yaml
services:
  api:
    build: .
    ports:
      - "${API_PORT:-3000}:3000"
    environment:
      DATABASE_URL: postgres://heorth:${POSTGRES_PASSWORD}@db:5432/heorth
      JWT_SECRET: ${JWT_SECRET}
      HOUSEHOLD_NAME: ${HOUSEHOLD_NAME}
      ADMIN_EMAIL: ${ADMIN_EMAIL}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD}
      API_PORT: 3000
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: heorth
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: heorth
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U heorth -d heorth"]
      interval: 5s
      timeout: 5s
      retries: 10
    restart: unless-stopped

volumes:
  postgres_data:
```

- [ ] **Step 6: Write `.env.example`**

```
DATABASE_URL=postgres://heorth:changeme@localhost:5432/heorth
JWT_SECRET=change-me-to-a-32-plus-character-random-string
HOUSEHOLD_NAME=Our Home
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-me
API_PORT=3000
JWT_TTL_SECONDS=604800
CORS_ORIGIN=*
DB_POOL_MAX=10
POSTGRES_PASSWORD=changeme
```

- [ ] **Step 7: Write `.gitignore`**

```
node_modules/
dist/
web/dist/
.env
*.log
```

- [ ] **Step 8: Write `Dockerfile`**

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run build:web
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

- [ ] **Step 9: Verify install & docker config**

Run: `npm install && docker compose config`
Expected: install completes; `docker compose config` prints the resolved compose file with no error.

- [ ] **Step 10: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts drizzle.config.ts docker-compose.yml .env.example .gitignore Dockerfile package-lock.json
git commit -m "chore: scaffold Heorth project config and dependencies"
```

---

