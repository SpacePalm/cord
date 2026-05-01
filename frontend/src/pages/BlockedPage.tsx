// Страница «вы заблокированы». Открывается из login-flow когда сервер
// вернул 403 с detail.code === 'blocked_by_security'.
//
// Параметры приходят через query-string: ?kind=ip|account&until=ISO

import { Link, useSearchParams } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useT, useLocale } from '../i18n';

export function BlockedPage() {
  const t = useT();
  const locale = useLocale();
  const [params] = useSearchParams();
  const kind = params.get('kind') === 'account' ? 'account' : 'ip';
  const until = params.get('until');

  // Тикер до окончания блокировки. Если until null — вечный бан.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const expiresAt = until ? new Date(until) : null;
  const expired = expiresAt && expiresAt.getTime() <= now;
  const remaining = expiresAt ? Math.max(0, expiresAt.getTime() - now) : null;
  const remainingText = remaining !== null ? formatDuration(remaining) : null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-tertiary)] p-4">
      <div className="w-full max-w-md bg-[var(--bg-secondary)] rounded-lg p-8 shadow-xl text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/15 flex items-center justify-center">
          <ShieldAlert size={32} className="text-red-400" />
        </div>

        <h1 className="text-xl font-bold text-[var(--text-primary)] mb-2">
          {t('blocked.title')}
        </h1>

        <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-4">
          {kind === 'account' ? t('blocked.descAccount') : t('blocked.descIp')}
        </p>

        <p className="text-sm text-[var(--text-muted)] mb-6">
          {t('blocked.contactAdmin')}
        </p>

        {expiresAt && !expired && (
          <div className="rounded-lg bg-[var(--bg-input)] border border-[var(--border-color)] p-3 mb-6">
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">
              {t('blocked.unlockIn')}
            </p>
            <p className="text-lg font-mono font-semibold text-[var(--text-primary)]">
              {remainingText}
            </p>
            <p className="text-[10px] text-[var(--text-muted)] mt-1">
              {expiresAt.toLocaleString(locale, {
                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
              })}
            </p>
          </div>
        )}

        {expired && (
          <p className="text-sm text-green-400 mb-6">{t('blocked.expired')}</p>
        )}

        <Link
          to="/login"
          className="inline-block px-4 py-2 rounded bg-[var(--accent)] text-white text-sm hover:bg-[var(--accent-hover)] transition-colors"
        >
          {t('blocked.backToLogin')}
        </Link>
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
