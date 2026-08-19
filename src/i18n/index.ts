import i18n from 'i18next';

import { initReactI18next } from 'react-i18next';
import en from './en.json';
import ru from './ru.json';

const resources = {
  en: { translation: en },
  ru: { translation: ru },
};

void i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'ru',
    fallbackLng: 'ru',
    supportedLngs: ['en', 'ru'],
    debug: false,
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;
