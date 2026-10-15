// iOS 26 Toggle: track 63×28 (accent ON / --ios-switch-off OFF), white pill knob 37×24,
// travel 22px, knob grows slightly while pressed.
import './ui.css';
import type { CSSProperties, MouseEvent } from 'react';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
  // additions
  /** ON colour (default tint = var(--accent)). */
  tint?: string;
  className?: string;
  style?: CSSProperties;
}

/** iOS 26 toggle 63×28, accent ON, pill knob 37×24. */
export function Switch({ checked, onChange, disabled, ariaLabel, tint, className, style }: SwitchProps) {
  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    // the whole ToggleRow is also a toggle target — don't toggle twice
    e.stopPropagation();
    if (!disabled) onChange(!checked);
  };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      className={['ios-switch', checked && 'is-on', className].filter(Boolean).join(' ')}
      style={tint ? { ...style, ['--tint' as string]: tint } : style}
      onClick={onClick}
    >
      <span className="ios-switch-knob" />
    </button>
  );
}
