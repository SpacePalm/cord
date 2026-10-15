// ProgressRing (CordControls.swift): track stroke 3 in textMuted@25%, accent arc with round
// caps from 12 o'clock (min 2%), centre number Int(value*100) (no "%") size*0.32 semibold textSecondary,
// linear 0.15s. The strokes sit ON the circle edge like SwiftUI `Circle().stroke` (half outside the frame).
import './ui.css';
import type { CSSProperties } from 'react';

export interface ProgressRingProps {
  /** 0…1 */
  value: number;
  /** Default 34 (22 in file chips). */
  size?: number;
  // additions
  /** Hide the centre number. */
  hideLabel?: boolean;
  style?: CSSProperties;
}

export function ProgressRing({ value, size = 34, hideLabel, style }: ProgressRingProps) {
  const v = Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
  const r = size / 2;
  const c = 2 * Math.PI * r;
  const shown = Math.max(0.02, v);
  return (
    <span
      className="ios-progress-ring"
      style={{ width: size, height: size, ...style }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.floor(v * 100)}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden focusable={false}>
        <circle cx={r} cy={r} r={r} fill="none" strokeWidth={3} style={{ stroke: 'color-mix(in srgb, var(--text-muted) 25%, transparent)' }} />
        <circle
          className="ios-progress-ring-arc"
          cx={r}
          cy={r}
          r={r}
          fill="none"
          style={{ stroke: 'var(--accent)' }}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown)}
          transform={`rotate(-90 ${r} ${r})`}
        />
      </svg>
      {!hideLabel && (
        <span className="ios-progress-ring-label" style={{ fontSize: size * 0.32 }}>
          {Math.floor(v * 100)}
        </span>
      )}
    </span>
  );
}
