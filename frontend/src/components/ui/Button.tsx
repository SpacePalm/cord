import { type ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'danger' | 'ghost';
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  children,
  className = '',
  ...props
}: ButtonProps) {
  const base =
    'px-4 py-2 rounded font-medium text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1';

  const variants = {
    primary: 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white focus:ring-[var(--accent)]',
    danger: 'bg-[var(--danger)] hover:opacity-90 text-white focus:ring-[var(--danger)]',
    ghost:
      'bg-transparent hover:bg-white/10 text-[var(--text-secondary)] focus:ring-white/20',
  };

  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`${base} ${variants[variant]} disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {loading ? 'Загрузка...' : children}
    </button>
  );
}
