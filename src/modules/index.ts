import type { HeorthModule } from './registry.js';
import { householdModule } from '../household/index.js';
import { calendarModule } from './calendar/index.js';
import { mealsModule } from './meals/index.js';
import { libraryModule } from './library/index.js';
import { ethelModule } from './ethel/index.js';
import { weorcModule } from './weorc/index.js';
import { tasksModule } from './tasks/index.js';
import { m365Module } from '../m365/index.js';
import { googleModule } from '../google/index.js';
import { integrationsModule } from '../integrations/index.js';
import { feohModule } from './feoh/index.js';
import { kithModule } from './kith/index.js';

export const ALL_MODULES: HeorthModule[] = [
  householdModule,
  calendarModule,
  mealsModule,
  libraryModule,
  // Ethel: the property register — assets and places; finance links live feoh-side.
  ethelModule,
  // Weorc: recurring household work — routines, history, and task projection.
  weorcModule,
  // Tasks: household task surface backed by Microsoft To Do (mirror always present).
  tasksModule,
  // M365 is a no-op when its env is absent (integration disabled) — see src/m365.
  m365Module,
  // Google is a no-op when its env is absent — see src/google.
  googleModule,
  // Integrations hosts the routes for every provider; providers register from
  // their own module, so this MUST come after them in this list.
  integrationsModule,
  // Finance (ADR 0007) is always on — see src/modules/feoh.
  feohModule,
  // KithLedger reminders proxy is a no-op when the KITH_* env group is absent — see src/modules/kith.
  kithModule,
];
