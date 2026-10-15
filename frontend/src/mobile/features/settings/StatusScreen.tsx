// iOS StatusSettingsView: segmented presence (online / idle / dnd / invisible) + status text,
// explicit Save (`PUT /auth/status`), "Статус обновлён" (stays). Picking a segment alone does not save.
import { useState } from 'react';
import { Screen } from '../../nav/Screen';
import { CordField, SegmentedControl } from '../../ui';
import { useMT } from '../../i18n';
import { useAuthStore } from '../../../store/authStore';
import { authApi } from '../../../api/auth';
import { SettingsForm, SettingsSaveButton, FormMessage, formErrorMessage, blurActive, applyUpdatedUser } from './common';
import './settings.css';

type Presence = 'online' | 'idle' | 'dnd' | 'invisible';
const OPTIONS: { value: Presence; key: string }[] = [
  { value: 'online', key: 'status.online' },
  { value: 'idle', key: 'status.idle' },
  { value: 'dnd', key: 'status.dnd' },
  { value: 'invisible', key: 'status.invisible' },
];

/** Presence segmented control + status text. */
export function StatusScreen() {
  const t = useMT();
  const user = useAuthStore((s) => s.user);
  const [status, setStatus] = useState<string>(() => user?.status ?? 'online');
  const [statusText, setStatusText] = useState(() => user?.status_text ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const changed = status !== (user?.status ?? '') || statusText !== (user?.status_text ?? '');

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const trimmed = statusText.trim();
      const updated = await authApi.updateStatus(status, trimmed ? trimmed : null);
      applyUpdatedUser(updated);
      setStatusText(updated.status_text ?? '');
      setMessage({ text: t('status.saved'), error: false });
    } catch (err) {
      setMessage({ text: formErrorMessage(err, t('profile.saveFailed'), (m) => t('common.errorPrefix', m)), error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={t('settings.status')}>
      <SettingsForm>
        <SegmentedControl<string>
          options={OPTIONS.map((o) => ({ value: o.value, label: t(o.key) }))}
          value={status}
          onChange={setStatus}
          ariaLabel={t('settings.status')}
          // iOS 26 draws the 32pt glass track ~2pt past its layout frame: the field sits 2pt higher than
          // a 32px box + 16 spacing [measured: track bottom 105.8 → field top 141.1 → button 201]
          style={{ marginBottom: -2 }}
        />
        <CordField
          label={t('status.textLabel')}
          placeholder={t('status.textPlaceholder')}
          value={statusText}
          onChange={setStatusText}
          maxLength={128}
          onSubmit={blurActive}
        />
        <SettingsSaveButton title={t('common.save')} busy={busy} enabled={changed} onPress={save} />
        <FormMessage text={message?.text ?? null} error={message?.error} />
      </SettingsForm>
    </Screen>
  );
}
