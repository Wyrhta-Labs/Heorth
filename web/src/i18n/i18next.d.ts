import 'i18next';
import en from './locales/en.json';

// Literal t() keys are type-checked against the English source catalog.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
  }
}
