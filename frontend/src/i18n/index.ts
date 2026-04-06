import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ru } from './ru';
import { en } from './en';

// ─── Language registry ──────────────────────────────────────────────
// To add a new language: 1) create a file xx.ts  2) add it here

export const LANGUAGES: Record<string, { label: string; translations: Record<string, string> }> = {
  ru: { label: 'Русский', translations: ru },
  en: { label: 'English', translations: en },
};

export const DEFAULT_LANG = 'en';

// ─── Store ──────────────────────────────────────────────────────────

interface LangState {
  lang: string;
  setLang: (lang: string) => void;
}

export const useLangStore = create<LangState>()(
  persist(
    (set) => ({
      lang: DEFAULT_LANG,
      setLang: (lang) => set({ lang }),
    }),
    { name: 'cord-lang' }
  )
);

// ─── Hook ───────────────────────────────────────────────────────────

export function useT() {
  const lang = useLangStore((s) => s.lang);
  const translations = LANGUAGES[lang]?.translations ?? LANGUAGES[DEFAULT_LANG].translations;

  return (key: string, params?: Record<string, string | number>): string => {
    let text = translations[key] ?? LANGUAGES[DEFAULT_LANG].translations[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(`{${k}}`, String(v));
      }
    }
    return text;
  };
}
