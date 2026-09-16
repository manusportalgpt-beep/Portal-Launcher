import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeLocalStorage } from '@/lib/safe-storage';
import i18n from '@/i18n';

export type Lang = 'en' | 'ru';

const NAMES: Record<Lang, string> = {
  en: 'English',
  ru: 'Русский',
};

interface LanguageState {
  lang: Lang;
  setLang: (l: Lang) => void;
  getName: (l: Lang) => string;
}

export const useLanguageStore = create<LanguageState>()(
  persist(
    (set) => ({
      lang: 'ru' as Lang,
      setLang: (lang: Lang) => {
        set({ lang });
        void i18n.changeLanguage(lang);
      },
      getName: (l: Lang) => NAMES[l],
    }),
    {
      name: 'portal-language',
      storage: createJSONStorage(() => safeLocalStorage()),
      version: 2,
      migrate: (persisted: any) => ({
        ...persisted,
        // Только явно сохранённый English остаётся English; новый/старый
        // неподдерживаемый locale безопасно возвращается к русскому default.
        lang: persisted?.lang === 'en' ? 'en' : 'ru',
      }),
      partialize: (state) => ({ lang: state.lang }),
    }
  )
);
