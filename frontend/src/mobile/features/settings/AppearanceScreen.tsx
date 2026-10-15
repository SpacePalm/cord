// iOS AppearanceSettingsView: Themes value row (→ ThemesSheet) + "Сохранить как пресет" (alert
// with text field), 12 colour rows, radius slider, preview card, Save ("Сохранено" after any successful
// persist this visit) and "Сбросить к тёмной". Draft semantics: colour/radius edits re-theme the app live
// (themeStore.previewTheme) but persist only on Save; a preset pick / reset / save-as / custom delete persists
// immediately. Leaving the screen reverts to the last persisted theme. The user's shape.fontSize/fontFamily
// are never changed from here (iOS ignores them; web must preserve them). Persists are serialised.
import { useEffect, useRef, useState } from 'react';
import { Screen } from '../../nav/Screen';
import { useScreenCtx } from '../../nav/NavStack';
import { InsetGroupedList, ListSection, Row, ValueRow, ButtonRow, ErrorRow, Slider, closeOpenSwipeRow } from '../../ui';
import { useMT } from '../../i18n';
import { usePresent } from '../../present/PresentationProvider';
import { useThemeStore, PRESET_THEMES, type Theme, type ThemeColors } from '../../../store/themeStore';
import { SettingsSaveButton, apiMessage } from './common';
import { ThemesSheet } from './ThemesSheet';
import './settings.css';

const COLOR_KEYS: { key: keyof ThemeColors; label: string }[] = [
  { key: 'accent', label: 'appearance.accent' },
  { key: 'accentHover', label: 'appearance.accentHover' },
  { key: 'accentText', label: 'appearance.accentText' },
  { key: 'bgPrimary', label: 'appearance.bgPrimary' },
  { key: 'bgSecondary', label: 'appearance.bgSecondary' },
  { key: 'bgTertiary', label: 'appearance.bgTertiary' },
  { key: 'bgInput', label: 'appearance.bgInput' },
  { key: 'textPrimary', label: 'appearance.textPrimary' },
  { key: 'textSecondary', label: 'appearance.textSecondary' },
  { key: 'textMuted', label: 'appearance.textMuted' },
  { key: 'borderColor', label: 'appearance.borderColor' },
  { key: 'dangerColor', label: 'appearance.dangerColor' },
];

/** `<input type=color>` needs #rrggbb. */
function toHex6(c: string): string {
  const s = (c || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return ('#' + s.slice(1).split('').map((x) => x + x).join('')).toLowerCase();
  if (/^#[0-9a-f]{8}$/i.test(s)) return s.slice(0, 7).toLowerCase();
  const m = s.match(/rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i);
  if (m) return '#' + [m[1], m[2], m[3]].map((v) => Math.min(255, Number(v)).toString(16).padStart(2, '0')).join('');
  return '#000000';
}

/** Deep-ish copy so a preview never aliases a stored theme object. */
function cloneTheme(th: Theme): Theme {
  return { name: th.name, colors: { ...th.colors }, shape: { ...th.shape } };
}

/** ColorPicker row: label + iOS colour well (the transparent <input type=color> on top takes the tap). */
function ColorRow({ title, value }: { title: string; value: string }) {
  return (
    <Row
      title={title}
      style={{ minHeight: 58 }}
      trailing={
        <span className="m-set-well" aria-hidden>
          <span style={{ background: value }} />
        </span>
      }
    />
  );
}

/** Theme preview, Themes sheet, colours, radius, save/reset. */
export function AppearanceScreen() {
  const t = useMT();
  const present = usePresent();
  const { isTop } = useScreenCtx();

  const [draft, setDraftState] = useState<Theme>(() => cloneTheme(useThemeStore.getState().current));
  const draftRef = useRef(draft);
  const [customs, setCustomsState] = useState<Theme[]>(() => useThemeStore.getState().customThemes.map(cloneTheme));
  const customsRef = useRef(customs);
  const [pending, setPending] = useState(0);
  const [everSaved, setEverSaved] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const alive = useRef(true);

  const setDraft = (next: Theme, preview = true) => {
    draftRef.current = next;
    setDraftState(next);
    if (preview) useThemeStore.getState().previewTheme(next);
  };
  const setCustoms = (next: Theme[]) => {
    customsRef.current = next;
    setCustomsState(next);
  };

  // iOS .onDisappear: leaving (pop, or a push on top) reverts to the last persisted theme
  useEffect(() => {
    if (isTop) return;
    useThemeStore.getState().revertPreview();
    const stored = useThemeStore.getState();
    draftRef.current = cloneTheme(stored.current);
    setDraftState(draftRef.current);
    customsRef.current = stored.customThemes.map(cloneTheme);
    setCustomsState(customsRef.current);
  }, [isTop]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      useThemeStore.getState().revertPreview();
    };
  }, []);

  /** Persist the current draft + custom themes (`PUT /auth/theme`); serialised, never dropped. */
  const persist = () => {
    setPending((n) => n + 1);
    const run = async () => {
      if (alive.current) setErrorText(null);
      const d = draftRef.current;
      const theme: Theme = { name: d.name || 'custom', colors: { ...d.colors }, shape: { ...d.shape } };
      try {
        await useThemeStore.getState().commitTheme(theme, customsRef.current.map(cloneTheme));
        if (alive.current) setEverSaved(true);
      } catch (err) {
        if (alive.current) setErrorText(apiMessage(err, t('appearance.saveFailed')));
      } finally {
        if (alive.current) setPending((n) => n - 1);
      }
    };
    queue.current = queue.current.then(run, run);
  };

  /** iOS apply(preset): colours + radius from the preset (fonts stay the user's), live + persist. */
  const applyPreset = (p: Theme) => {
    const d = draftRef.current;
    setDraft({
      name: p.name,
      colors: { ...p.colors },
      shape: { ...d.shape, borderRadius: p.shape?.borderRadius ?? 8 },
    });
    persist();
  };

  const deleteCustom = (p: Theme) => {
    setCustoms(customsRef.current.filter((x) => x.name !== p.name));
    persist();
  };

  const saveAsPreset = (raw: string) => {
    const name = raw.trim();
    if (!name) return;
    const d = draftRef.current;
    const entry: Theme = { name, colors: { ...d.colors }, shape: { ...d.shape } };
    setCustoms([entry, ...customsRef.current.filter((x) => x.name !== name)]);
    setDraft({ ...d, name });
    persist();
  };

  // callbacks handed to the sheet / alert read the latest state through refs
  const actions = useRef({ applyPreset, deleteCustom, saveAsPreset });
  actions.current = { applyPreset, deleteCustom, saveAsPreset };

  const openThemes = () => {
    closeOpenSwipeRow();
    const currentName = draftRef.current.name === 'custom' ? '' : draftRef.current.name;
    present.presentSheet(({ dismiss }) => (
      <ThemesSheet
        customs={customsRef.current}
        currentName={currentName}
        onApply={(p) => actions.current.applyPreset(p)}
        onDelete={(p) => actions.current.deleteCustom(p)}
        dismiss={dismiss}
      />
    ));
  };

  const openSaveAs = () => {
    present.alert({
      title: t('appearance.saveAsPreset'),
      textField: { placeholder: t('appearance.presetName'), initial: '' },
      actions: [
        { label: t('common.save'), onPress: (v) => actions.current.saveAsPreset(v) },
        { label: t('pollComposer.cancel'), role: 'cancel' },
      ],
    });
  };

  const setColor = (key: keyof ThemeColors, hex: string) => {
    const d = draftRef.current;
    setDraft({ ...d, name: 'custom', colors: { ...d.colors, [key]: hex } });
  };

  const setRadius = (r: number) => {
    const d = draftRef.current;
    if (d.shape.borderRadius === r) return;
    setDraft({ ...d, shape: { ...d.shape, borderRadius: r } });
  };
  const commitRadius = () => {
    const d = draftRef.current;
    if (d.name !== 'custom') setDraft({ ...d, name: 'custom' });
  };

  const presetLabel = !draft.name || draft.name === 'custom' ? t('appearance.custom') : draft.name;
  const radius = draft.shape.borderRadius ?? 8;

  return (
    <Screen title={t('appearance.title')}>
      <InsetGroupedList>
        <ListSection>
          <ValueRow title={t('appearance.presets')} value={presetLabel} valueColor="var(--text-muted)" chevronStyle="muted" onPress={openThemes} />
          <ButtonRow icon="square.and.arrow.down" title={t('appearance.saveAsPreset')} onPress={openSaveAs} />
        </ListSection>

        <ListSection header={t('appearance.colors')}>
          {COLOR_KEYS.map(({ key, label }) => (
            <label key={key} className="ios-cell" style={{ position: 'relative', display: 'block' }}>
              <ColorRow title={t(label)} value={draft.colors[key]} />
              <input
                type="color"
                className="m-set-color-input"
                aria-label={t(label)}
                value={toHex6(draft.colors[key])}
                onChange={(e) => setColor(key, e.target.value)}
              />
            </label>
          ))}
        </ListSection>

        <ListSection header={t('appearance.shape')}>
          <Row>
            <div className="m-set-radius">
              <div className="m-set-radius-head">
                <span style={{ color: 'var(--text-primary)' }}>{t('appearance.borderRadius')}</span>
                <span className="ios-tabular" style={{ color: 'var(--text-muted)' }}>
                  {radius}
                </span>
              </div>
              <Slider
                value={radius}
                min={0}
                max={20}
                step={1}
                onChange={setRadius}
                onCommit={commitRadius}
                ariaLabel={t('appearance.borderRadius')}
              />
            </div>
          </Row>
        </ListSection>

        <ListSection header={t('appearance.preview')}>
          <Row>
            <div className="m-set-preview">
              <div className="m-set-preview-head">
                <span className="m-set-preview-dot" />
                <div>
                  <div className="m-set-preview-name">Alice</div>
                  <div className="m-set-preview-text">Hey everyone! 👋</div>
                </div>
              </div>
              <span className="m-set-preview-pill">cord</span>
            </div>
          </Row>
        </ListSection>

        <ListSection>
          <Row>
            <div className="m-set-btnrow">
              <SettingsSaveButton title={everSaved ? t('common.saved') : t('common.save')} busy={pending > 0} enabled onPress={persist} />
            </div>
          </Row>
          <ButtonRow title={t('appearance.reset')} role="destructive" align="center" onPress={() => applyPreset(PRESET_THEMES[0])} />
        </ListSection>

        {errorText && (
          <ListSection>
            <ErrorRow text={errorText} />
          </ListSection>
        )}
      </InsetGroupedList>
    </Screen>
  );
}
