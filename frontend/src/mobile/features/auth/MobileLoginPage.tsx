// iOS LoginView (+ RegisterView sheet) for /login and /register on phones.
// No nav bar, ScrollView form on --bg-primary, default dark palette while logged out,
// inline errors incl. the security block, blocked-notice box after a forced logout
// (/login?blocked=<kind>&until=<iso>), register as a large sheet without nav bar over the login screen.
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { authApi } from '../../../api/auth';
import { useAuthStore } from '../../../store/authStore';
import { MobileRoot } from '../../MobileRoot';
import { present } from '../../present/PresentationProvider';
import { CordButton, CordField, Icon, useKeyboardInset } from '../../ui';
import { useMT } from '../../i18n';
import { blockMessage, errorText } from './authErrors';
import { darkPresetVars, finishLogin, safeNext, useLoggedOutPalette } from './session';
import { useBlurOnDrag } from './useBlurOnDrag';
import { RegisterSheet } from './RegisterSheet';
import './auth.css';

export interface MobileLoginPageProps {
  /** /register URL: open the registration sheet over the login screen on mount. */
  register?: boolean;
}

interface BlockedParams {
  kind: string;
  until: string | null;
}

function blockedFrom(params: URLSearchParams): BlockedParams | null {
  const kind = params.get('blocked');
  if (!kind) return null;
  return { kind, until: params.get('until') };
}

export function MobileLoginPage(props: MobileLoginPageProps) {
  const token = useAuthStore((s) => s.token);
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  // Signed in (also right after a successful login/registration): plain swap to the app, like iOS.
  if (token) return <Navigate to={next ?? '/app'} replace />;
  return (
    <div className="m-home-auth-theme" style={darkPresetVars()}>
      <MobileRoot>
        <LoginScreen register={!!props.register} />
      </MobileRoot>
    </div>
  );
}

function LoginScreen({ register }: { register: boolean }) {
  const t = useMT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [blocked, setBlocked] = useState<BlockedParams | null>(() => blockedFrom(params));
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const kb = useKeyboardInset();
  useBlurOnDrag(scrollRef);
  useLoggedOutPalette();

  // a later forced logout lands here with fresh params
  useEffect(() => {
    const b = blockedFrom(params);
    if (b) setBlocked(b);
  }, [params]);

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const openRegister = useCallback(() => {
    present.presentSheet((ctx) => <RegisterSheet dismiss={ctx.dismiss} />, {
      onDismiss: () => {
        // /register: closing the sheet leaves the user on the login screen
        if (window.location.pathname === '/register') {
          navigateRef.current({ pathname: '/login', search: window.location.search }, { replace: true });
        }
      },
    });
  }, []);

  useEffect(() => {
    if (!register) return;
    // after PresentationProvider's own mount effect (parents' effects run after children's)
    const id = window.setTimeout(openRegister, 0);
    return () => window.clearTimeout(id);
  }, [register, openRegister]);

  const canLogin = !busy && email.length > 0 && password.length > 0;

  const login = async () => {
    if (busyRef.current || !email || !password) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    // iOS clears blockedNotice at the start of login()
    setBlocked(null);
    if (params.has('blocked') || params.has('until')) {
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          n.delete('blocked');
          n.delete('until');
          return n;
        },
        { replace: true },
      );
    }
    try {
      // email as typed (iOS does not trim on login)
      const data = await authApi.login({ email, password });
      finishLogin(qc, data);
    } catch (e) {
      setError(errorText(e, t('auth.loginFailed')));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void login();
  };

  return (
    <div className="m-home-auth-scroll" ref={scrollRef} style={{ bottom: kb }}>
      <form className="m-home-auth-content" onSubmit={onSubmit} noValidate autoComplete="on">
        {/* iOS "Сменить сервер" row — dropped on web (same origin), height kept */}
        <div className="m-home-auth-toprow" aria-hidden />
        <h1 className="m-home-auth-title">cord</h1>
        {blocked && (
          <div className="m-home-auth-notice" role="alert">
            <Icon name="lock.shield" size={16} strokeWidth={2} />
            <span>{blockMessage(blocked.kind, blocked.until)}</span>
          </div>
        )}
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
          // iOS: Return only ends editing (no onSubmit on the field)
          onSubmit={() => (document.activeElement as HTMLElement | null)?.blur()}
        />
        <CordField
          label={t('common.password')}
          placeholder={t('auth.passwordPlaceholder')}
          value={password}
          onChange={setPassword}
          secure
          autoComplete="current-password"
          name="password"
          enterKeyHint="go"
          inputRef={passwordRef}
          onSubmit={() => {
            if (canLogin) void login();
            else passwordRef.current?.blur();
          }}
        />
        <CordButton type="submit" busy={busy} disabled={!canLogin}>
          {busy ? t('auth.loggingIn') : t('auth.login')}
        </CordButton>
        {error && (
          <div className="m-home-auth-error" role="alert">
            {error}
          </div>
        )}
        <div className="m-home-auth-footer">
          <span>{t('auth.noAccount')}</span>
          <button type="button" className="m-home-auth-link is-accent" onClick={openRegister}>
            {t('auth.createAccount')}
          </button>
        </div>
      </form>
    </div>
  );
}
