// CordButtonStyle (DesignSystem/CordControls.swift): full width, 15px semibold, padding-y 12
// (42px), radius = theme --radius. primary: accent (pressed accent-hover), WHITE text; danger: danger (pressed
// 85%), white; ghost: clear (pressed white 10%), --text-secondary. Disabled: opacity 0.5. Busy: white spinner + label
// and disabled (iOS `.disabled(isBusy || …)` → also dimmed to 0.5).
import './ui.css';
import type { CSSProperties, ReactNode } from 'react';
import { Spinner } from './Spinner';

export interface CordButtonProps {
  children: ReactNode;
  variant?: 'primary' | 'danger' | 'ghost';
  /** White spinner + label. */
  busy?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  type?: 'button' | 'submit';
  // additions
  style?: CSSProperties;
  className?: string;
  ariaLabel?: string;
}

/** Full-width 42px button, 15px semibold, radius --radius; primary = white on accent. */
export function CordButton({ children, variant = 'primary', disabled, busy, onPress, type = 'button', style, className, ariaLabel }: CordButtonProps) {
  const cls = ['ios-cord-btn', `ios-cord-btn--${variant}`, busy && 'is-busy', className].filter(Boolean).join(' ');
  return (
    <button
      type={type}
      className={cls}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      aria-label={ariaLabel}
      style={style}
      onClick={onPress ? () => onPress() : undefined}
    >
      {busy && <Spinner size="regular" color={variant === 'ghost' ? 'var(--text-secondary)' : '#fff'} />}
      {children}
    </button>
  );
}
