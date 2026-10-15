// iOS RegisterView: large sheet WITHOUT a nav bar over the login screen; closes via its own "Войти"
// link or swipe-down. Register → auto-login → app.
import { useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authApi } from '../../../api/auth';
import { SheetScreen } from '../../nav/Screen';
import { CordButton, CordField, graphemeCount } from '../../ui';
import { useMT } from '../../i18n';
import { blockInfoOf, errorText, userMessage } from './authErrors';
import { finishLogin, trimWhitespaces } from './session';
import { useBlurOnDrag } from './useBlurOnDrag';
import './auth.css';

export function RegisterSheet({ dismiss }: { dismiss: () => Promise<void> }) {
  const t = useMT();
  const qc = useQueryClient();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useBlurOnDrag(scrollRef);

  const trimmedUsername = trimWhitespaces(username);
  const trimmedEmail = trimWhitespaces(email);
  const passwordCount = graphemeCount(password);
  const passwordTooShort = password.length > 0 && passwordCount < 6;
  const confirmMismatch = confirm.length > 0 && confirm !== password;
  const isValid =
    trimmedUsername.length > 0 &&
    trimmedEmail.includes('@') &&
    graphemeCount(trimmedEmail) >= 3 &&
    passwordCount >= 6 &&
    confirm === password;

  const register = async () => {
    if (busyRef.current || !isValid) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      try {
        // 1. create the account (the response carries no tokens)
        await authApi.register({ username: trimmedUsername, email: trimmedEmail, password });
      } catch (e) {
        setError(errorText(e, t('auth.registerFailed')));
        return;
      }
      try {
        // 2. sign in with the same credentials → app (the sheet goes away with the login screen)
        const data = await authApi.login({ email: trimmedEmail, password });
        finishLogin(qc, data);
      } catch (e) {
        // account exists; keep the sheet open so the reason stays visible
        setError(blockInfoOf(e) ? userMessage(e, t('auth.loginBlocked')) : t('auth.registeredButLoginFailed'));
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void register();
  };

  const blurActive = () => (document.activeElement as HTMLElement | null)?.blur();

  return (
    <SheetScreen noBar scrollRef={scrollRef}>
      <form className="m-home-auth-content is-sheet" onSubmit={onSubmit} noValidate autoComplete="on">
        <div className="m-home-auth-toprow">
          <button type="button" className="m-home-auth-link" onClick={() => void dismiss()}>
            {t('auth.login')}
          </button>
        </div>
        <h1 className="m-home-auth-title">{t('auth.registerTitle')}</h1>
        <CordField
          label={t('auth.username')}
          placeholder={t('auth.usernamePlaceholder')}
          value={username}
          onChange={setUsername}
          autoComplete="username"
          name="username"
          enterKeyHint="done"
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
          name="email"
          enterKeyHint="done"
          onSubmit={blurActive}
        />
        <div className="m-home-auth-group">
          <CordField
            label={t('common.password')}
            placeholder={t('auth.passwordMinPlaceholder')}
            value={password}
            onChange={setPassword}
            secure
            autoComplete="new-password"
            name="new-password"
            enterKeyHint="done"
            onSubmit={blurActive}
          />
          {passwordTooShort && <div className="m-home-auth-hint">{t('auth.passwordMinPlaceholder')}</div>}
        </div>
        <div className="m-home-auth-group">
          <CordField
            label={t('auth.passwordRepeat')}
            placeholder={t('auth.passwordRepeatPlaceholder')}
            value={confirm}
            onChange={setConfirm}
            secure
            autoComplete="new-password"
            name="confirm-password"
            enterKeyHint="done"
            onSubmit={blurActive}
          />
          {confirmMismatch && <div className="m-home-auth-hint is-danger">{t('auth.passwordMismatch')}</div>}
        </div>
        <CordButton type="submit" busy={busy} disabled={!isValid}>
          {busy ? t('auth.registering') : t('auth.register')}
        </CordButton>
        {error && (
          <div className="m-home-auth-error" role="alert">
            {error}
          </div>
        )}
      </form>
    </SheetScreen>
  );
}
