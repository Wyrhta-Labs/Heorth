// Runtime barrel (.js extensions). Re-exports @wyrhta/core tables so Heorth's
// single migration set covers identity + household + all module tables.
export { users, apiKeys, userRole } from '@wyrhta/core/identity';
export { household } from '@wyrhta/core/household';
// Module tables are appended here as each module lands:
// export * from './../../household/schema.js';  (Heorth-local, if any)
export * from '../../modules/calendar/schema.js';
// export * from './../../modules/meals/schema.js';
// export * from './../../modules/feoh/schema.js';
