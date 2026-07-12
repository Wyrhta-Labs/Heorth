# Heorth 0.1 — @wyrhta/core reconciliations (VERIFIED vs the plan's assumed contract)

Depend on **`github:Wyrhta-Labs/wyrhta-core#v0.1.1`** (v0.1.1 fixed the ESM/drizzle-kit issue).
The plan's "Consumed @wyrhta/core surface" block is ASSUMED and wrong in several places
(same drift as the KithLedger plan). Code against the REAL surface below. Centralize ALL core
adaptation in a thin Heorth wiring layer (Task 0.2/0.4 per the plan) so module code is insulated.

## Identity (`@wyrhta/core/identity`) — NO factory; standalone fns take `db` first
- There is NO `createIdentityService(db)`. Real exports: `createUser(db,input)`, `updateUser(db,id,patch)`,
  `deleteUser(db,id)`, `getUser?`… verify exact set; `authenticate(db,email,password)`, `issueToken(user,secret,ttl)`,
  `createApiKey(db,userId,name,prefix)`, `listApiKeys(db,userId?)`, `revokeApiKey(db,userId,keyId)`,
  `validateApiKey(raw,lookupFn)`, `hashPassword`, `verifyPassword`, `signToken(claims,secret,ttl)`,
  `verifyToken(token,secret,algorithm?)`. Tables: `users`, `apiKeys`, `userRole` (enum, name is `userRole` not `roleEnum`).
- `createApiKey(...)` returns `{ id, name, prefix, createdAt, key }` — raw key under **`key`** (NOT `raw`), and **`prefix`** (NOT `keyPrefix`). `revokeApiKey(db,userId,keyId)` → **boolean**.
- Build a Heorth-local `identity` wrapper (partial-application over `db` + config) exposing the methods modules need, exactly like KithLedger's `src/identity.ts`.

## Household (`@wyrhta/core/household`) — standalone fns; DOES NOT seed admin
- Real exports: `household` (singleton table), `seedHousehold(db,{name,timezone?,locale?}) -> Household`,
  `listMembers(db) -> Member[]`, `setRole(db,userId,role) -> User`. **NO `createHouseholdService` factory, NO `getHousehold`.**
- `seedHousehold` creates ONLY the household row (idempotent via singleton unique). It does NOT create the admin user.
  Heorth boot (Task 0.5) must: `seedHousehold(db,...)` AND separately `createUser(db,{email,password,role:'admin',...})`
  if no admin exists. Read the household via a direct `db.select().from(household).limit(1)` (there is no getHousehold).

## Auth guards (`@wyrhta/core/auth`) — context key is `principal`, NOT `auth`
- `createAuthGuards({ jwtSecret, keyPrefix, resolveApiKey })` is a real FACTORY → `{ requireAuth, requireJwt, requireRole }`.
  (The plan imports bare `requireAuth`/`requireJwt`/`requireRole` — instead build them once in the wiring layer via the factory.)
- Guards set **`c.set('principal', { type, userId, role })`** — NOT `c.get('auth')`. EVERYWHERE the plan reads
  `c.get('auth')` / `auth.userId` / `auth.role` (role guards, and the child-scope `created_by === auth.userId`
  checks in Calendar/Meals), read `c.get('principal')` instead. This is pervasive — get it right in every route.
- JWT branch verifies sig+alg+exp+string `sub`, NO db lookup, NO role-claim requirement. `requireRole(...roles)`
  reads `principal.role`. `detectAuthScheme`: prefix `he_` → api_key, `eyJ` → jwt. Set `keyPrefix: 'he_'` in the factory.
- `resolveApiKey(raw)` bridge: hash+lookup in Heorth's apiKeys, return `{ type:'api_key', userId, role }` (join to users for role).

## HTTP (`@wyrhta/core/http`) — all here (no /http/middleware subpath)
- `ok`, `err`, `parsePagination`, `requestId`, `securityHeaders`, `errorHandler`, `rateLimit` ALL from `@wyrhta/core/http`.
  `rateLimit` is a FACTORY → `rateLimit()` (defaults 15min/10). The plan's import list here is correct.

## Lib (`@wyrhta/core/lib`)
- `logEvent`, `logError`, `generateApiKey({prefix})->{raw,hash,prefix}`, `hashKey(raw)`.

## MCP (`@wyrhta/core/mcp`) — STDIO scaffold; NO HTTP transport
- Real: `McpTool { name, description, inputSchema: z.ZodRawShape, handler(ctx,input)->McpToolResult }`;
  `McpToolContext = { principal: {userId,role}, requestId }` (NOT `{userId,role,requestId}`);
  `McpToolResult = { content:[{type:'text',text}], isError? }`;
  `AuthAdapter = { resolve(): Promise<McpPrincipal> }` (no-arg, THROW to deny; called every tool call);
  `createMcpServer(registry, authAdapter, info?)` returns the official `@modelcontextprotocol/sdk` `McpServer`.
- inputSchema is a ZodRawShape: use `someZodObject.shape` (for `.refine()` schemas use `._def.schema.shape`).
- Tool success → `{ content:[{type:'text', text: JSON.stringify(data)}] }`; map domain errors (NOT_FOUND/CONFLICT/FORBIDDEN)
  by throwing (scaffold catches → generic isError; per-tool messages currently swallowed — known core limitation).
- **ARCHITECTURAL GAP for Phase 6:** the plan wants MCP-over-HTTP (`createMcpServer(...).fetch(req)` mounted as an
  HTTP endpoint). Core's `createMcpServer` returns an SDK `McpServer` with NO `.fetch()`; core ships only a stdio
  path. RESOLUTION OPTIONS (decide at Phase 6): (a) wire the MCP SDK's `StreamableHTTPServerTransport` in Heorth and
  bridge Hono's Request/Response to it (add `@modelcontextprotocol/sdk` as a direct dep); (b) ship MCP-over-stdio for
  0.1 (a `src/mcp/index.ts` stdio entrypoint like KithLedger) and defer HTTP. **Ask the user at Phase 6.**

## Env / dependency / test harness notes
- Dependency: `"@wyrhta/core": "github:Wyrhta-Labs/wyrhta-core#v0.1.1"`.
- Env read from `process.env` (no dotenv). Heorth test DB: Postgres container `kith-testdb`, host port 55432,
  database **`heorth`** (created). `DATABASE_URL=postgres://kith:kithpw@localhost:55432/heorth`. `set -a && source .env && set +a`
  before test/db commands. Add `@modelcontextprotocol/sdk` as a direct dep if/when wiring MCP transport.
- API key prefix is **`he_`** (Heorth), not `kl_`. JWT_SECRET >= 32 chars. Money = numeric(14,2) as strings.
- See also the KithLedger precedent (same core, prefix kl_): everything there worked against v0.1.1.
