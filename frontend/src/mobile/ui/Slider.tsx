// iOS 26 Slider: 6px capsule track (accent fill / --ios-fill-1 rest), white pill knob 38×24 that grows while
// dragged. Native <input type=range> underneath (keyboard + a11y for free).
import './ui.css';
import type { CSSProperties } from 'react';

export interface SliderProps {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  style?: CSSProperties;
  // additions
  /** Fill colour (default tint = var(--accent)). */
  tint?: string;
  ariaLabel?: string;
  /** Fired when the drag ends (pointer up / change committed). */
  onCommit?: (v: number) => void;
}

export function Slider({ value, onChange, min, max, step = 1, disabled, style, tint, ariaLabel, onCommit }: SliderProps) {
  const p = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
  const vars: Record<string, string | number> = { '--p': p };
  if (tint) vars['--fill'] = tint;
  return (
    <input
      type="range"
      className="ios-slider"
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      aria-label={ariaLabel}
      style={{ ...vars, ...style } as CSSProperties}
      onChange={(e) => onChange(Number(e.target.value))}
      onPointerUp={onCommit ? (e) => onCommit(Number(e.currentTarget.value)) : undefined}
      onKeyUp={onCommit ? (e) => onCommit(Number(e.currentTarget.value)) : undefined}
    />
  );
}
