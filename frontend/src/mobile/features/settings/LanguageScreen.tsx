// iOS LanguageSettingsView: one section "Язык интерфейса", native names (Русский, English),
// accent checkmark on the active one; switching is live. Synced to /auth/preferences by preferencesSync
// (it subscribes to useLangStore), exactly like the desktop LanguageTab.
import { Screen } from '../../nav/Screen';
import { InsetGroupedList, ListSection, CheckRow } from '../../ui';
import { useMT } from '../../i18n';
import { useLangStore, LANGUAGES } from '../../../i18n';
import './settings.css';

const ORDER = ['ru', 'en'];

/** Language checkmark list. */
export function LanguageScreen() {
  const t = useMT();
  const lang = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);
  const codes = [...ORDER.filter((c) => LANGUAGES[c]), ...Object.keys(LANGUAGES).filter((c) => !ORDER.includes(c))];

  return (
    <Screen title={t('settings.language')}>
      <InsetGroupedList>
        <ListSection header={t('lang.title')}>
          {codes.map((code) => (
            <CheckRow key={code} title={LANGUAGES[code].label} checked={lang === code} onPress={() => setLang(code)} />
          ))}
        </ListSection>
      </InsetGroupedList>
    </Screen>
  );
}
