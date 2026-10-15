// /blocked?kind=&until= on a phone. iOS has no such page — it shows the
// block inline on the login screen — so this is the same LoginView scaffold: "cord", the
// lock.shield notice box (block.* strings), a live countdown like the desktop BlockedPage, and a primary
// button back to the login screen (carrying the notice).
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MobileRoot } from '../../MobileRoot';
import { CordButton, Icon } from '../../ui';
import { useMT } from '../../i18n';
import { blockMessage, formatBlockDate } from './authErrors';
import { darkPresetVars, useLoggedOutPalette } from './session';
import './auth.css';

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function MobileBlockedPage() {
  return (
    <div className="m-home-auth-theme" style={darkPresetVars()}>
      <MobileRoot>
        <BlockedScreen />
      </MobileRoot>
    </div>
  );
}

function BlockedScreen() {
  const t = useMT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const kind = params.get('kind') === 'account' ? 'account' : 'ip';
  const until = params.get('until');
  useLoggedOutPalette();

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const expiresAt = until ? new Date(until) : null;
  const validExpiry = expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null;
  const expired = !!validExpiry && validExpiry.getTime() <= now;
  const remaining = validExpiry ? Math.max(0, validExpiry.getTime() - now) : null;

  const backToLogin = () => {
    const sp = new URLSearchParams();
    if (!expired) {
      sp.set('blocked', kind);
      if (until) sp.set('until', until);
    }
    const q = sp.toString();
    navigate(q ? `/login?${q}` : '/login', { replace: true });
  };

  return (
    <div className="m-home-auth-scroll">
      <div className="m-home-auth-content">
        <div className="m-home-auth-toprow" aria-hidden />
        <h1 className="m-home-auth-title">cord</h1>
        <div className="m-home-auth-notice" role="alert">
          <Icon name="lock.shield" size={16} strokeWidth={2} />
          <span>{blockMessage(kind, until)}</span>
        </div>
        {validExpiry && !expired && remaining !== null && (
          <div className="m-home-blocked-card">
            <div className="m-home-blocked-caption">{t('blocked.unlockIn')}</div>
            <div className="m-home-blocked-timer">{formatDuration(remaining)}</div>
            <div className="m-home-blocked-date">{formatBlockDate(until as string)}</div>
          </div>
        )}
        {expired && <div className="m-home-blocked-expired">{t('blocked.expired')}</div>}
        <CordButton onPress={backToLogin}>{t('auth.login')}</CordButton>
      </div>
    </div>
  );
}
