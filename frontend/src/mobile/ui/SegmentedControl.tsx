// iOS 26 segmented control: 32px capsule track (--ios-fill-3), sliding thumb
// (--ios-gray-2, radius 14, inset 2), 13px white labels (selected semibold, others medium, truncating).
import './ui.css';
import type { CSSProperties } from 'react';

export interface SegmentedControlProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  style?: CSSProperties;
  // additions
  disabled?: boolean;
  ariaLabel?: string;
}

export function SegmentedControl<T extends string>({ options, value, onChange, style, disabled, ariaLabel }: SegmentedControlProps<T>) {
  const n = Math.max(1, options.length);
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  const found = options.some((o) => o.value === value);
  return (
    <div className={'ios-segmented' + (disabled ? ' is-disabled' : '')} role="radiogroup" aria-label={ariaLabel} style={style}>
      {found && (
        <span
          className="ios-segmented-thumb"
          aria-hidden
          style={{
            width: `calc((100% - 4px - ${n - 1} * var(--seg-gap)) / ${n})`,
            transform: `translateX(calc(${idx} * (100% + var(--seg-gap))))`,
          }}
        />
      )}
      {options.map((o) => {
        const sel = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={sel}
            disabled={disabled}
            className={'ios-segmented-seg' + (sel ? ' is-selected' : '')}
            onClick={() => {
              if (!sel) onChange(o.value);
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
