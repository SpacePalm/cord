import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { groupsApi } from '../api/groups';
import { useAuthStore } from '../store/authStore';
import { useT } from '../i18n';

export function InvitePage() {
  const t = useT();
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const [info, setInfo] = useState<{ group_name: string; member_count: number } | null>(null);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!code) return;
    groupsApi.getInvite(code).then(setInfo).catch(() => setError(t('invite.invalid')));
  }, [code]);

  const handleJoin = async () => {
    if (!token) { navigate(`/login?next=/invite/${code}`); return; }
    setJoining(true);
    try {
      await groupsApi.joinByInvite(code!);
      navigate('/app');
    } catch {
      setError(t('invite.error'));
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
      <div className="bg-[var(--bg-secondary)] rounded-xl p-8 w-full max-w-sm text-center shadow-2xl">
        {error ? (
          <p className="text-[var(--danger)]">{error}</p>
        ) : info ? (
          <>
            <div className="w-16 h-16 rounded-2xl bg-[var(--accent)] flex items-center justify-center text-white text-2xl font-bold mx-auto mb-4">
              {info.group_name.slice(0, 2).toUpperCase()}
            </div>
            <h2 className="text-xl font-bold text-[var(--text-primary)]">{info.group_name}</h2>
            <p className="text-sm text-[var(--text-muted)] mt-1">{info.member_count} {t('invite.members')}</p>
            <button
              onClick={handleJoin}
              disabled={joining}
              className="mt-6 w-full py-2.5 rounded bg-[var(--accent)] text-white font-medium hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors"
            >
              {joining ? t('invite.joining') : t('invite.join')}
            </button>
          </>
        ) : (
          <div className="w-8 h-8 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin mx-auto" />
        )}
      </div>
    </div>
  );
}
