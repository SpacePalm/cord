// CordField (DesignSystem/CordControls.swift): optional UPPERCASE caption label (12px
// semibold, tracking 0.6, --text-secondary), 6px gap, 44px field (padding 11×12, --bg-input, radius --radius),
// 17px --text-primary text, --text-muted placeholder, accent caret, 1.5px inner accent border while focused;
// secure fields get an eye / eye.slash reveal button. Never autocapitalises/autocorrects; maxLength trims
// (grapheme-safe, like Swift `count`).
import './ui.css';
import { useId, useState, type CSSProperties, type Ref } from 'react';
import { Icon } from './Icon';
import { graphemeCount, prefixGraphemes } from './text';

export interface CordFieldProps {
  /** Uppercased caption label above the field (12px semibold, tracking 0.6, --text-secondary). */
  label?: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  /** Password field with eye / eye.slash reveal button. */
  secure?: boolean;
  type?: 'text' | 'email' | 'url';
  autoComplete?: string;
  inputMode?: 'text' | 'email' | 'numeric' | 'url';
  enterKeyHint?: 'done' | 'go' | 'next' | 'search' | 'send';
  maxLength?: number;
  autoFocus?: boolean;
  disabled?: boolean;
  onSubmit?: () => void;
  inputRef?: Ref<HTMLInputElement>;
  // additions
  style?: CSSProperties;
  ariaLabel?: string;
  name?: string;
  onFocus?: () => void;
  onBlur?: () => void;
}

export function CordField({
  label,
  placeholder,
  value,
  onChange,
  secure,
  type,
  autoComplete,
  inputMode,
  enterKeyHint,
  maxLength,
  autoFocus,
  disabled,
  onSubmit,
  inputRef,
  style,
  ariaLabel,
  name,
  onFocus,
  onBlur,
}: CordFieldProps) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const inputType = secure ? (revealed ? 'text' : 'password') : type ?? 'text';

  return (
    <div className="ios-field-wrap" style={style}>
      {label && (
        <label htmlFor={id} className="ios-field-label">
          {label.toUpperCase()}
        </label>
      )}
      <div className={'ios-field' + (focused ? ' is-focused' : '') + (disabled ? ' is-disabled' : '')}>
        <input
          id={id}
          ref={inputRef}
          name={name}
          type={inputType}
          value={value}
          placeholder={placeholder}
          aria-label={ariaLabel ?? (label ? undefined : placeholder)}
          autoComplete={autoComplete ?? (secure ? 'current-password' : 'off')}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode={inputMode}
          enterKeyHint={enterKeyHint}
          autoFocus={autoFocus}
          disabled={disabled}
          onFocus={() => {
            setFocused(true);
            onFocus?.();
          }}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          onChange={(e) => {
            const v = e.target.value;
            onChange(maxLength != null && graphemeCount(v) > maxLength ? prefixGraphemes(v, maxLength) : v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && onSubmit) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
        {secure && (
          <button
            type="button"
            className="ios-field-eye"
            aria-label={revealed ? 'Hide' : 'Show'}
            tabIndex={-1}
            onPointerDown={(e) => e.preventDefault() /* keep focus in the field */}
            onClick={() => setRevealed((r) => !r)}
          >
            <Icon name={revealed ? 'eye.slash' : 'eye'} size={21} />
          </button>
        )}
      </div>
    </div>
  );
}
