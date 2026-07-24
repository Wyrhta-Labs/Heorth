// Used by drizzle-kit (CJS bundler): no .js extensions.
export { users, apiKeys, userRole } from '@wyrhta/core/identity';
export { household } from '@wyrhta/core/household';
// Module tables appended as each module lands (see schema/index.ts).
export * from '../../modules/calendar/schema';
export * from '../../modules/meals/schema';
// feoh tables removed — the finance domain now lives in the Feoh satellite service.
export * from '../../modules/library/schema';
export * from '../../m365/schema';
