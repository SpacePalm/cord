// iOS ThemePickerSheet (AppearanceSettingsView.swift:202-279): large sheet, inline title "Темы",
// `.confirmationAction` "Закрыть", `.searchable` (iOS 26: bottom glass capsule), sections "Своя" (swipe
// delete, persisted immediately, no confirmation) and "Все темы" (127 presets, raw names). Row = 40×22 swatch
// (bgPrimary | accent | textPrimary) + name + accent checkmark on the name current at open time. Tap applies
// (live + persisted) and dismisses.
import { useMemo, useState } from 'react';
import { SheetScreen } from '../../nav/Screen';
import { BarTextButton } from '../../nav/BarButton';
import { InsetGroupedList, ListSection, Row, SwipeRow, SearchCapsule, Icon } from '../../ui';
import { useMT } from '../../i18n';
import { PRESET_THEMES, type Theme } from '../../../store/themeStore';
import './settings.css';

export interface ThemesSheetProps {
  customs: Theme[];
  currentName: string;
  onApply: (theme: Theme) => void;
  onDelete: (theme: Theme) => void;
  dismiss: () => Promise<void>;
}

function Swatch({ theme }: { theme: Theme }) {
  const c = theme.colors;
  return (
    <span className="m-set-swatch" aria-hidden>
      <span style={{ background: c.bgPrimary }} />
      <span style={{ background: c.accent }} />
      <span style={{ background: c.textPrimary }} />
    </span>
  );
}

export function ThemesSheet({ customs: initialCustoms, currentName, onApply, onDelete, dismiss }: ThemesSheetProps) {
  const t = useMT();
  const [search, setSearch] = useState('');
  const [customs, setCustoms] = useState(initialCustoms);

  const match = useMemo(() => {
    const q = search.toLocaleLowerCase();
    return (list: Theme[]) => (q ? list.filter((p) => p.name.toLocaleLowerCase().includes(q)) : list);
  }, [search]);

  const mine = match(customs);
  const all = match(PRESET_THEMES);

  const row = (p: Theme) => (
    <Row
      leading={<Swatch theme={p} />}
      leadingGap={10}
      title={p.name}
      titleLines={1}
      ariaLabel={p.name}
      onPress={() => {
        onApply(p);
        void dismiss();
      }}
      trailing={p.name === currentName ? <Icon name="checkmark" size={22} strokeWidth={2} color="var(--accent)" /> : undefined}
    />
  );

  return (
    <SheetScreen
      title={t('appearance.presets')}
      trailing={
        <BarTextButton prominent onPress={() => void dismiss()}>
          {t('common.close')}
        </BarTextButton>
      }
    >
      <InsetGroupedList>
        {mine.length > 0 && (
          <ListSection header={t('appearance.custom')}>
            {mine.map((p) => (
              <SwipeRow
                key={`custom-${p.name}`}
                actions={[
                  {
                    icon: 'trash',
                    label: t('chat.delete'),
                    onPress: () => {
                      setCustoms((list) => list.filter((x) => x.name !== p.name));
                      onDelete(p);
                    },
                  },
                ]}
              >
                {row(p)}
              </SwipeRow>
            ))}
          </ListSection>
        )}
        <ListSection header={t('appearance.allThemes')}>
          {all.map((p) => (
            <div key={p.name} className="ios-cell">
              {row(p)}
            </div>
          ))}
        </ListSection>
      </InsetGroupedList>
      <SearchCapsule value={search} onChange={setSearch} placeholder={t('appearance.searchThemes')} />
    </SheetScreen>
  );
}
