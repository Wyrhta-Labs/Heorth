import type { HeorthModule } from './registry.js';
import { householdModule } from '../household/index.js';
import { calendarModule } from './calendar/index.js';
import { mealsModule } from './meals/index.js';
import { libraryModule } from './library/index.js';
import { inventoryModule } from './inventory/index.js';
import { tasksModule } from './tasks/index.js';
import { m365Module } from '../m365/index.js';
import { feohModule } from './feoh/index.js';
import { kithModule } from './kith/index.js';

export const ALL_MODULES: HeorthModule[] = [
  householdModule,
  calendarModule,
  mealsModule,
  libraryModule,
  // Inventory: household items + lifecycle; finance links live feoh-side.
  inventoryModule,
  // Tasks: household task surface backed by Microsoft To Do (mirror always present).
  tasksModule,
  // M365 is a no-op when its env is absent (integration disabled) — see src/m365.
  m365Module,
  // Finance (ADR 0007) is always on — see src/modules/feoh.
  feohModule,
  // KithLedger reminders proxy is a no-op when the KITH_* env group is absent — see src/modules/kith.
  kithModule,
];
