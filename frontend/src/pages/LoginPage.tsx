import { useState } from 'react';
import { useNavigate, Link, Navigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '../api/auth';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import { applyServerPreferences, startPreferencesAutoSync } from '../utils/preferencesSync';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { ApiError } from '../api/client';
import { useT } from '../i18n';

export function LoginPage() {
  const t = useT();
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const setAuth = useAuthStore((s) => s.setAuth);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const loginMutation = useMutation({
    mutationFn: authApi.login,
    onSuccess: async (data) => {
      // Save the token and fetch user data
      localStorage.setItem('access_token', data.access_token);
      const user = await authApi.me();
      useThemeStore.getState().loadFromServer(user.theme_json ?? null);
      applyServerPreferences(user.preferences_json);
      startPreferencesAutoSync();
      setAuth(user, data.access_token);
      navigate('/app');
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(t('login.networkError'));
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    loginMutation.mutate({ email, password });
  };

  // Already authenticated — after all hooks
  if (token) return <Navigate to="/app" replace />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-tertiary)]">
      <div className="w-full max-w-sm bg-[var(--bg-secondary)] rounded-lg p-8 shadow-xl">
        <img src="/full_logo.png" alt="Cord" className="w-64 mx-auto mb-8" />
        <h1 className="text-2xl font-bold text-center text-[var(--text-primary)] mb-2">
          {t('login.title')}
        </h1>
        <p className="text-sm text-center text-[var(--text-secondary)] mb-6">
          {t('login.subtitle')}
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@example.com"
            required
            autoFocus
          />
          <Input
            label={t('login.password')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            error={error}
          />

          <Button
            type="submit"
            loading={loginMutation.isPending}
            className="w-full mt-2"
          >
            {t('login.submit')}
          </Button>
        </form>

        <p className="text-sm text-[var(--text-muted)] text-center mt-6">
          {t('login.noAccount')}{' '}
          <Link to="/register" className="text-[var(--accent)] hover:underline">
            {t('login.register')}
          </Link>
        </p>
      </div>
    </div>
  );
}
