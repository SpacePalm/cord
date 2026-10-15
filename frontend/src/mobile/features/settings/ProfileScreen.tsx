// iOS ProfileSettingsView: ScrollView form — AvatarUploader, display name, email, read-only
// username, Save (enabled only when the trimmed values differ from the live user), transient "✓ Профиль
// обновлён" (2 s). No Cancel; leaving discards edits.
import { useEffect, useRef, useState } from 'react';
import { Screen } from '../../nav/Screen';
import { CordField } from '../../ui';
import { useMT } from '../../i18n';
import { useAuthStore } from '../../../store/authStore';
import { authApi } from '../../../api/auth';
import { AvatarUploader } from '../media/AvatarUploader';
import { SettingsForm, SettingsSaveButton, FormMessage, formErrorMessage, blurActive, applyUpdatedUser } from './common';
import './settings.css';

/** Profile: avatar uploader + display name. */
export function ProfileScreen() {
  const t = useMT();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [username] = useState(() => user?.username ?? '');
  const [displayName, setDisplayName] = useState(() => user?.display_name ?? '');
  const [email, setEmail] = useState(() => user?.email ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const hideTimer = useRef(0);

  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  const changed = displayName.trim() !== (user?.display_name ?? '') || email.trim() !== (user?.email ?? '');

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    window.clearTimeout(hideTimer.current);
    try {
      const updated = await authApi.updateProfile({ display_name: displayName.trim(), email: email.trim() });
      applyUpdatedUser(updated);
      setDisplayName(updated.display_name);
      setEmail(updated.email);
      const text = t('profile.saved');
      setMessage({ text, error: false });
      hideTimer.current = window.setTimeout(() => setMessage((m) => (m && m.text === text && !m.error ? null : m)), 2000);
    } catch (err) {
      setMessage({ text: formErrorMessage(err, t('profile.saveFailed'), (m) => t('common.errorPrefix', m)), error: true });
    } finally {
      setBusy(false);
    }
  };

  const uploadAvatar = async (file: File) => {
    const updated = await authApi.uploadAvatar(file);
    // cache-buster so every <img> of the own avatar reloads (iOS bumps env.avatarVersion)
    setUser({ ...updated, image_path: updated.image_path ? `${updated.image_path}?t=${Date.now()}` : updated.image_path });
  };

  return (
    <Screen title={t('settings.profile')}>
      <SettingsForm>
        <AvatarUploader imagePath={user?.image_path || null} name={displayName} onUpload={uploadAvatar} />

        <CordField
          label={t('profile.displayName')}
          placeholder={t('profile.displayNamePlaceholder')}
          value={displayName}
          onChange={setDisplayName}
          maxLength={50}
          autoComplete="nickname"
          onSubmit={blurActive}
        />
        <CordField
          label={t('common.email')}
          placeholder={t('auth.emailPlaceholder')}
          value={email}
          onChange={setEmail}
          type="email"
          inputMode="email"
          autoComplete="email"
          onSubmit={blurActive}
        />

        <div className="m-set-ro">
          <div className="m-set-ro-label">{t('profile.usernameLabel')}</div>
          <div className="m-set-ro-value ios-selectable">@{username}</div>
          <div className="m-set-caption">{t('profile.usernameHint')}</div>
        </div>

        <SettingsSaveButton title={t('common.save')} busy={busy} enabled={changed} onPress={save} />
        <FormMessage text={message?.text ?? null} error={message?.error} />
      </SettingsForm>
    </Screen>
  );
}
