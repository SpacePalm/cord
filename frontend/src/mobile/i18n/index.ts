// Mobile string lookup. Mobile UI must read byte-identical to the iOS app, so the
// primary dictionary is a verbatim port of cord-ios Localizable.strings (ios.*.ts).
// Lookup order: iOS dictionary → mobile extras (./extra/*.ts) → web i18n → key.
// Placeholders follow iOS printf style: %@, %d, %1$@ / %2$d (positional).
import { useCallback } from 'react';
import { useLangStore, LANGUAGES, DEFAULT_LANG } from '../../i18n';
import { iosRu } from './ios.ru';
import { iosEn } from './ios.en';

type Dict = Record<string, string>;
type ExtraModule = { ru?: Dict; en?: Dict };

const IOS: Record<string, Dict> = { ru: iosRu, en: iosEn };

// Each feature area may add its own mobile-only strings in ./extra/<area>.ts
// exporting `export const ru = {...}; export const en = {...};` — no shared file to edit.
const extraModules = import.meta.glob<ExtraModule>('./extra/*.ts', { eager: true });
const EXTRA: Record<string, Dict> = { ru: {}, en: {} };
for (const mod of Object.values(extraModules)) {
  Object.assign(EXTRA.ru, mod.ru ?? {});
  Object.assign(EXTRA.en, mod.en ?? {});
}

export type MtArg = string | number;

/** Formats an iOS printf-style template: %@, %d, %ld, %lld, %i, %1$@ … and %% */
export function formatIos(template: string, args: MtArg[], locale: string): string {
  let seq = 0;
  return template.replace(/%(?:(\d+)\$)?(@|lld|ld|d|i|%)/g, (_m, pos: string | undefined, spec: string) => {
    if (spec === '%') return '%';
    const idx = pos ? Number(pos) - 1 : seq++;
    const v = args[idx];
    if (v === undefined) return '';
    if (spec === '@') return typeof v === 'number' ? new Intl.NumberFormat(locale).format(v) : String(v);
    // %d family: iOS groups thousands with the locale separator ("123 456" / "123,456").
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n) : String(v);
  });
}

function lookup(lang: string, key: string): string | undefined {
  return (
    IOS[lang]?.[key] ??
    EXTRA[lang]?.[key] ??
    LANGUAGES[lang]?.translations[key] ??
    IOS[DEFAULT_LANG]?.[key] ??
    EXTRA[DEFAULT_LANG]?.[key] ??
    LANGUAGES[DEFAULT_LANG]?.translations[key]
  );
}

/** Non-hook variant (for utilities / callbacks outside React render). */
export function mt(key: string, ...args: MtArg[]): string {
  const lang = useLangStore.getState().lang;
  const tpl = lookup(lang, key) ?? key;
  const locale = LANGUAGES[lang]?.locale ?? 'en-US';
  return args.length ? formatIos(tpl, args, locale) : tpl;
}

/** `const t = useMT(); t('main.saved'); t('poll.votes', 3); t('block.until', who, when)` */
export function useMT() {
  const lang = useLangStore((s) => s.lang);
  return useCallback(
    (key: string, ...args: MtArg[]): string => {
      const tpl = lookup(lang, key) ?? key;
      const locale = LANGUAGES[lang]?.locale ?? 'en-US';
      return args.length ? formatIos(tpl, args, locale) : tpl;
    },
    [lang],
  );
}

/** BCP-47 locale of the current UI language (for Intl date/number formatting). */
export function useMobileLocale(): string {
  const lang = useLangStore((s) => s.lang);
  return LANGUAGES[lang]?.locale ?? 'en-US';
}
