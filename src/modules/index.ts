import type { HeorthModule } from './registry.js';
import { householdModule } from '../household/index.js';
import { calendarModule } from './calendar/index.js';
import { mealsModule } from './meals/index.js';

// Modules are appended here as each phase lands (compile-time registration):
//   import { feohModule } from './feoh/index.js';
export const ALL_MODULES: HeorthModule[] = [
  householdModule,
  calendarModule,
  mealsModule,
  // feohModule
];
