import { type InputHTMLAttributes, forwardRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', type, ...props }, ref) => {
    const isPassword = type === 'password';
    const [showPassword, setShowPassword] = useState(false);

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
            {label}
          </label>
        )}
        <div className="relative">
          <input
            ref={ref}
            {...props}
            type={isPassword && showPassword ? 'text' : type}
            className={`
              w-full px-3 py-2 rounded
              bg-[var(--bg-input)] text-[var(--text-primary)]
              border border-transparent
              focus:outline-none focus:border-[var(--accent)]
              placeholder:text-[var(--text-muted)]
              text-sm
              ${isPassword ? 'pr-9' : ''}
              ${error ? 'border-[var(--danger)]' : ''}
              ${className}
            `}
          />
          {isPassword && (
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          )}
        </div>
        {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
