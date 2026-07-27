import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import de from './locales/de.json';

// The DEFAULT i18next instance, initialized at module import: useTranslation()
// works app-wide (and in tests) without an I18nextProvider wrapper. Language is
// driven exclusively by household.locale via I18nProvider — no browser detector.
void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    de: { translation: de },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React already escapes
});

export default i18n;
