// iOS NotificationsSettingsView: "Что показывать" radio rows (synced level) + sound
// toggle with footer. Web-only first section: browser notification permission + opt-in —
// shown only where the Notification API exists (iOS Safari: installed PWA only). The toggle displays
// `browserEnabled && permission === 'granted'` (the flag syncs across devices; this phone may never have
// granted permission). Levels/sound are never dimmed (iOS never dims).
import { useEffect, useState } from 'react';
import { Screen } from '../../nav/Screen';
import { InsetGroupedList, ListSection, RadioRow, ToggleRow } from '../../ui';
import { useMT } from '../../i18n';
import { useNotificationStore, type NotificationLevel } from '../../../store/notificationStore';
import './settings.css';

const LEVELS: { value: NotificationLevel; label: string; hint: string }[] = [
  { value: 'all', label: 'notifications.levelAll', hint: 'notifications.levelAllHint' },
  { value: 'mentions_dm', label: 'notifications.levelMentions', hint: 'notifications.levelMentionsHint' },
  { value: 'dm_only', label: 'notifications.levelDmOnly', hint: 'notifications.levelDmOnlyHint' },
  { value: 'off', label: 'notifications.levelOff', hint: 'notifications.levelOffHint' },
];

type Perm = NotificationPermission | 'unsupported';

function readPermission(): Perm {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

async function requestPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied';
  try {
    // old Safari only supports the callback form
    return await new Promise<NotificationPermission>((resolve) => {
      const r = Notification.requestPermission((p) => resolve(p));
      if (r && typeof (r as Promise<NotificationPermission>).then === 'function') (r as Promise<NotificationPermission>).then(resolve, () => resolve('denied'));
    });
  } catch {
    return Notification.permission;
  }
}

/** Notification level radios + sound toggle (+ web browser-notification section). */
export function NotificationsScreen() {
  const t = useMT();
  const level = useNotificationStore((s) => s.level);
  const setLevel = useNotificationStore((s) => s.setLevel);
  const sound = useNotificationStore((s) => s.sound);
  const setSound = useNotificationStore((s) => s.setSound);
  const browserEnabled = useNotificationStore((s) => s.browserEnabled);
  const setBrowserEnabled = useNotificationStore((s) => s.setBrowserEnabled);
  const [perm, setPerm] = useState<Perm>(readPermission);
  const [asking, setAsking] = useState(false);

  // iOS re-checks the OS authorisation on appear; the web also when the app comes back to the foreground
  useEffect(() => {
    const sync = () => setPerm(readPermission());
    sync();
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  const supported = perm !== 'unsupported';
  const browserOn = browserEnabled && perm === 'granted';

  const toggleBrowser = async (on: boolean) => {
    if (!on) {
      setBrowserEnabled(false);
      return;
    }
    if (asking) return;
    setAsking(true);
    try {
      const p = perm === 'granted' ? 'granted' : await requestPermission();
      setPerm(p);
      setBrowserEnabled(p === 'granted');
    } finally {
      setAsking(false);
    }
  };

  return (
    <Screen title={t('settings.notifications')}>
      <InsetGroupedList>
        {supported && (
          <ListSection footer={perm === 'denied' ? <div style={{ color: 'var(--danger)' }}>{t('notifications.denied')}</div> : undefined}>
            <ToggleRow
              title={t('settings.notifBrowser')}
              subtitle={t('settings.notifBrowserHint')}
              checked={browserOn}
              busy={asking}
              onChange={(v) => void toggleBrowser(v)}
            />
          </ListSection>
        )}

        <ListSection header={t('notifications.levelTitle')}>
          {LEVELS.map((l) => (
            <RadioRow key={l.value} title={t(l.label)} subtitle={t(l.hint)} selected={level === l.value} onPress={() => setLevel(l.value)} />
          ))}
        </ListSection>

        <ListSection
          footer={
            <>
              <div>{t('settings.notifSoundFooterWeb')}</div>
              {!supported && <div>{t('settings.notifUnsupported')}</div>}
            </>
          }
        >
          <ToggleRow title={t('notifications.sound')} subtitle={t('notifications.soundHint')} checked={sound} onChange={setSound} />
        </ListSection>
      </InsetGroupedList>
    </Screen>
  );
}
