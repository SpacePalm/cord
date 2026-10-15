// StatusDot (DesignSystem/StatusDot.swift): grey when offline or invisible, else
// idle → yellow, dnd → red, online/unknown → green (iOS system colours). Optional 2px ring drawn INSIDE
// the size in the surrounding background colour (`Circle().strokeBorder(ring, 2)`).
import './ui.css';
import type { CSSProperties } from 'react';

export interface StatusDotProps {
  status?: string | null;
  isOnline: boolean;
  /** Default 11. */
  size?: number;
  /** 2px ring (drawn inside the size) in the surrounding background colour. */
  ring?: string;
  // additions
  className?: string;
  style?: CSSProperties;
}

export function statusColor(status: string | null | undefined, isOnline: boolean): string {
  if (!isOnline || status === 'invisible') return 'var(--ios-gray, #8E8E93)';
  if (status === 'idle') return 'var(--ios-yellow, #FFD600)';
  if (status === 'dnd') return 'var(--ios-red, #FF4245)';
  return 'var(--ios-green, #30D158)';
}

export function StatusDot({ status, isOnline, size = 11, ring, className, style }: StatusDotProps) {
  return (
    <span
      className={className ? `ios-status-dot ${className}` : 'ios-status-dot'}
      aria-hidden
      style={{
        width: size,
        height: size,
        background: statusColor(status, isOnline),
        border: ring ? `2px solid ${ring}` : undefined,
        ...style,
      }}
    />
  );
}
