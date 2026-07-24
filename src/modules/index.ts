import type { HeorthModule } from './registry.js';
import { householdModule } from '../household/index.js';
import { calendarModule } from './calendar/index.js';
import { mealsModule } from './meals/index.js';
import { libraryModule } from './library/index.js';

// NOTE: `feoh` is intentionally absent — it is no longer an in-process module.
// The finance domain was extracted to the Feoh satellite service; Heorth mounts
// a proxy for it in `createApp` (see src/satellites/feoh/).
export const ALL_MODULES: HeorthModule[] = [
  householdModule,
  calendarModule,
  mealsModule,
  libraryModule,
];
