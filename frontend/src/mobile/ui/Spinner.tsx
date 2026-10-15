// iOS activity indicator (UIActivityIndicatorView, 8 spokes).
// regular ≈20px, small ≈16px, mini ≈12px; colour = environment tint (accent) unless given ('#fff' in buttons).
import './ui.css';
import type { CSSProperties } from 'react';

export interface SpinnerProps {
  /** regular ≈20px, small ≈16px, mini ≈12px, or explicit px. */
  size?: 'regular' | 'small' | 'mini' | number;
  /** Default var(--accent) (iOS env tint). Inside primary buttons: '#fff'. */
  color?: string;
  // additions
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}

const SPOKES = Array.from({ length: 8 }, (_, k) => k);

export function Spinner({ size = 'regular', color, className, style, ariaLabel }: SpinnerProps) {
  const px = typeof size === 'number' ? size : size === 'small' ? 16 : size === 'mini' ? 12 : 20;
  return (
    <svg
      className={className ? `ios-spinner ${className}` : 'ios-spinner'}
      width={px}
      height={px}
      viewBox="0 0 20 20"
      role="progressbar"
      aria-label={ariaLabel}
      aria-busy
      style={{ color: color ?? 'var(--tint, var(--accent))', ...style }}
    >
      {SPOKES.map((k) => (
        <line
          key={k}
          x1="10"
          y1="1.9"
          x2="10"
          y2="6.1"
          stroke="currentColor"
          strokeWidth="2.15"
          strokeLinecap="round"
          // clockwise rotation: the brightest spoke leads, the trail fades counter-clockwise
          opacity={0.22 + (0.78 * k) / 7}
          transform={`rotate(${k * 45} 10 10)`}
        />
      ))}
    </svg>
  );
}
