import { type InputHTMLAttributes, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
            {label}
          </label>
        )}
        <input
          ref={ref}
          {...props}
          className={`
            w-full px-3 py-2 rounded
            bg-[var(--bg-input)] text-[var(--text-primary)]
            border border-transparent
            focus:outline-none focus:border-[var(--accent)]
            placeholder:text-[var(--text-muted)]
            text-sm
            ${error ? 'border-[var(--danger)]' : ''}
            ${className}
          `}
        />
        {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
