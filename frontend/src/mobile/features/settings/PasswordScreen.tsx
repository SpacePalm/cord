// iOS PasswordSettingsView: three secure CordFields, live mismatch hint, session note, "Изменить
// пароль" enabled only when current ≠ "" ∧ new ≥ 6 ∧ confirm == new; success clears the fields.
import { useState } from 'react';
import { Screen } from '../../nav/Screen';
import { CordField } from '../../ui';
import { useMT } from '../../i18n';
import { authApi } from '../../../api/auth';
import { graphemeCount } from '../../ui/text';
import { SettingsForm, SettingsSaveButton, FormMessage, formErrorMessage, blurActive, applyUpdatedUser } from './common';
import './settings.css';

/** Change password form. */
export function PasswordScreen() {
  const t = useMT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const valid = current !== '' && graphemeCount(next) >= 6 && confirm === next;
  const mismatch = confirm !== '' && confirm !== next;

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const updated = await authApi.updateProfile({ current_password: current, new_password: next });
      applyUpdatedUser(updated);
      setCurrent('');
      setNext('');
      setConfirm('');
      setMessage({ text: t('password.changed'), error: false });
    } catch (err) {
      setMessage({ text: formErrorMessage(err, t('password.changeFailed'), (m) => t('common.errorPrefix', m)), error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={t('settings.changePassword')}>
      <SettingsForm>
        <CordField
          label={t('password.current')}
          placeholder={t('password.currentPlaceholder')}
          value={current}
          onChange={setCurrent}
          secure
          autoComplete="current-password"
          onSubmit={blurActive}
        />
        <CordField
          label={t('password.new')}
          placeholder={t('password.newPlaceholder')}
          value={next}
          onChange={setNext}
          secure
          autoComplete="new-password"
          onSubmit={blurActive}
        />
        <CordField
          label={t('password.repeat')}
          placeholder={t('password.repeatPlaceholder')}
          value={confirm}
          onChange={setConfirm}
          secure
          autoComplete="new-password"
          onSubmit={blurActive}
        />
        {mismatch && <div className="m-set-caption is-danger">{t('auth.passwordMismatch')}</div>}
        <div className="m-set-caption">{t('password.sessionNote')}</div>
        <SettingsSaveButton title={t('password.change')} busy={busy} enabled={valid} onPress={save} />
        <FormMessage text={message?.text ?? null} error={message?.error} />
      </SettingsForm>
    </Screen>
  );
}
