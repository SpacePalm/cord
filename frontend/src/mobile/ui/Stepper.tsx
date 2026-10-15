// iOS 26 Stepper: glass capsule 94×32 with "−" | "+" halves (--ios-fill-3, 1px divider), glyphs --ios-label,
// disabled half at --ios-label-3. Press-and-hold repeats (like UIStepper autorepeat). Approximate metrics (not measured).
import './ui.css';
import { useEffect, useRef, type CSSProperties } from 'react';
import { Icon } from './Icon';

export interface StepperProps {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  // additions
  style?: CSSProperties;
  ariaLabel?: string;
}

const round = (v: number, step: number) => {
  const decimals = (String(step).split('.')[1] ?? '').length;
  return decimals ? Number(v.toFixed(decimals)) : Math.round(v);
};

export function Stepper({ value, onChange, min, max, step = 1, disabled, style, ariaLabel }: StepperProps) {
  const live = useRef({ value, onChange, min, max, step });
  live.current = { value, onChange, min, max, step };
  const timer = useRef(0);

  const stop = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = 0;
  };
  useEffect(() => stop, []);

  const bump = (dir: 1 | -1): boolean => {
    const s = live.current;
    const next = round(Math.min(s.max, Math.max(s.min, s.value + dir * s.step)), s.step);
    if (next === s.value) return false;
    s.value = next;
    s.onChange(next);
    return true;
  };

  const start = (dir: 1 | -1) => {
    stop();
    if (!bump(dir)) return;
    let delay = 450;
    const tick = () => {
      if (!bump(dir)) return stop();
      delay = Math.max(60, delay * 0.8);
      timer.current = window.setTimeout(tick, delay);
    };
    timer.current = window.setTimeout(tick, delay);
  };

  const half = (dir: 1 | -1) => {
    const off = disabled || (dir < 0 ? value <= min : value >= max);
    return (
      <button
        type="button"
        className="ios-stepper-btn"
        disabled={off}
        aria-label={dir < 0 ? '−' : '+'}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          start(dir);
        }}
        onPointerUp={stop}
        onPointerCancel={stop}
        onLostPointerCapture={stop}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            bump(dir);
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Icon name={dir < 0 ? 'minus' : 'plus'} size={20} strokeWidth={2} />
      </button>
    );
  };

  return (
    <span className="ios-stepper" role="group" aria-label={ariaLabel} style={style}>
      {half(-1)}
      {half(1)}
    </span>
  );
}
