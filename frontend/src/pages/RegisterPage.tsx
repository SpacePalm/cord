import { useState } from 'react';
import { useNavigate, Link, Navigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '../api/auth';
import { useAuthStore } from '../store/authStore';
import { ApiError } from '../api/client';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useT } from '../i18n';

export function RegisterPage() {
  const t = useT();
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const registerMutation = useMutation({
    mutationFn: authApi.register,
    onSuccess: () => {
      // After registration — redirect to login page
      navigate('/login', { state: { registered: true } });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(t('register.networkError'));
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    registerMutation.mutate({ username, email, password });
  };

  // Already authenticated — after all hooks
  if (token) return <Navigate to="/app" replace />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-tertiary)]">
      <div className="w-full max-w-sm bg-[var(--bg-secondary)] rounded-lg p-8 shadow-xl">
        <img src="/full_logo.png" alt="Cord" className="w-64 mx-auto mb-8" />
        <h1 className="text-2xl font-bold text-center text-[var(--text-primary)] mb-2">
          {t('register.title')}
        </h1>
        <p className="text-sm text-center text-[var(--text-secondary)] mb-6">
          {t('register.subtitle')}
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            label={t('register.username')}
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="cooluser"
            required
            autoFocus
          />
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@example.com"
            required
          />
          <Input
            label={t('register.password')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('register.passwordHint')}
            required
            minLength={6}
            error={error}
          />

          <Button
            type="submit"
            loading={registerMutation.isPending}
            className="w-full mt-2"
          >
            {t('register.submit')}
          </Button>
        </form>

        <p className="text-sm text-[var(--text-muted)] text-center mt-6">
          {t('register.hasAccount')}{' '}
          <Link to="/login" className="text-[var(--accent)] hover:underline">
            {t('register.login')}
          </Link>
        </p>
      </div>
    </div>
  );
}
