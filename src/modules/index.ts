import type { HeorthModule } from './registry.js';
import { householdModule } from '../household/index.js';
import { calendarModule } from './calendar/index.js';
import { mealsModule } from './meals/index.js';
import { libraryModule } from './library/index.js';
import { tasksModule } from './tasks/index.js';
import { m365Module } from '../m365/index.js';

// NOTE: `feoh` is intentionally absent — it is no longer an in-process module.
// The finance domain was extracted to the Feoh satellite service; Heorth mounts
// a proxy for it in `createApp` (see src/satellites/feoh/).
export const ALL_MODULES: HeorthModule[] = [
  householdModule,
  calendarModule,
  mealsModule,
  libraryModule,
  // Tasks: household task surface backed by Microsoft To Do (mirror always present).
  tasksModule,
  // M365 is a no-op when its env is absent (integration disabled) — see src/m365.
  m365Module,
];
