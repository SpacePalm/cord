// iOS StorageSettingsView: media cache size (spinner while loading), menu Picker for the LRU
// limit (256 MB … 5 GB, "Без лимита"), "Очистить кэш" (destructive, no confirmation; disabled while clearing
// or when empty). Backed by the mobile media cache (features/media/mediaCache — Cache Storage on disk, memory
// fallback). Sizes use ByteCountFormatter(.file) semantics: decimal units, "Zero KB".
import { useEffect, useState } from 'react';
import { Screen } from '../../nav/Screen';
import { InsetGroupedList, ListSection, Row, PickerRow, ButtonRow, Spinner } from '../../ui';
import { useMT, useMobileLocale, mt } from '../../i18n';
import { useLangStore } from '../../../i18n';
import {
  getMediaCacheMax,
  setMediaCacheMax,
  mediaCacheTotalBytes,
  clearMediaCache,
  mediaCacheOnDisk,
  subscribeMediaCache,
} from '../media/mediaCache';
import './settings.css';

const MIB = 1024 * 1024;
const OPTIONS = [256 * MIB, 512 * MIB, 1024 * MIB, 2048 * MIB, 5120 * MIB, 0];

/** `ByteCountFormatter.string(fromByteCount:countStyle: .file)` — decimal, adaptive fraction digits. */
export function formatBytes(bytes: number, locale: string): string {
  if (bytes <= 0) return mt('storage.zero');
  if (bytes < 1000) {
    const lang = useLangStore.getState().lang;
    const cat = new Intl.PluralRules(lang === 'ru' ? 'ru-RU' : 'en-US').select(bytes);
    const key = cat === 'one' ? 'storage.bytes.one' : cat === 'few' ? 'storage.bytes.few' : 'storage.bytes.many';
    return mt(key, bytes);
  }
  const units: [number, string, number][] = [
    [1e12, 'storage.unit.tb', 2],
    [1e9, 'storage.unit.gb', 2],
    [1e6, 'storage.unit.mb', 1],
    [1e3, 'storage.unit.kb', 0],
  ];
  for (const [base, key, digits] of units) {
    if (bytes >= base * 0.9995 || base === 1e3) {
      const v = bytes / base;
      const num = new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(v);
      return `${num} ${mt(key)}`;
    }
  }
  return String(bytes);
}

/** Data & storage (media cache). */
export function StorageScreen() {
  const t = useMT();
  const locale = useMobileLocale();
  const [used, setUsed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [maxBytes, setMaxBytes] = useState(() => getMediaCacheMax());
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    let alive = true;
    const refresh = () =>
      mediaCacheTotalBytes().then(
        (n) => alive && setUsed(n),
        () => undefined,
      );
    setMaxBytes(getMediaCacheMax());
    void refresh().finally(() => alive && setLoading(false));
    const unsub = subscribeMediaCache(() => void refresh());
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  const changeLimit = async (v: number) => {
    setMaxBytes(v);
    await setMediaCacheMax(v);
    setUsed(await mediaCacheTotalBytes());
  };

  const clear = async () => {
    if (clearing) return;
    setClearing(true);
    try {
      await clearMediaCache();
      setUsed(await mediaCacheTotalBytes());
    } finally {
      setClearing(false);
    }
  };

  return (
    <Screen title={t('settings.storage')}>
      <InsetGroupedList>
        <ListSection footer={mediaCacheOnDisk() ? t('storage.footer') : t('settings.storageFooterMemory')}>
          <Row
            title={t('storage.used')}
            trailing={
              loading ? (
                <Spinner />
              ) : (
                <span className="ios-row-value ios-tabular" style={{ color: 'var(--text-muted)' }}>
                  {formatBytes(used, locale)}
                </span>
              )
            }
          />
        </ListSection>

        <ListSection header={t('storage.limit')}>
          <PickerRow<string>
            title={t('storage.maxSize')}
            value={String(maxBytes)}
            options={OPTIONS.map((b) => ({ value: String(b), label: b === 0 ? t('storage.unlimited') : formatBytes(b, locale) }))}
            onChange={(v) => void changeLimit(Number(v))}
          />
        </ListSection>

        <ListSection>
          <ButtonRow
            title={t('storage.clear')}
            role="destructive"
            busy={clearing}
            disabled={clearing || used === 0}
            // a disabled destructive List button is grey on iOS (tertiaryLabel): label-2 × the row's 0.45 dimming ≈ label-3
            color={clearing || used === 0 ? 'var(--ios-label-2)' : undefined}
            onPress={() => void clear()}
          />
        </ListSection>
      </InsetGroupedList>
    </Screen>
  );
}
