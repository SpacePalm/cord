// Search fields.
// (a) CordSearchField — the custom HStack used by QuickSwitcher / ChatSearch / AdvancedSearch.
// (b) SearchCapsule — system `.searchable`: iOS 26 floating glass capsule at the bottom, or under the nav bar
//     ('drawer', MediaLinks `.navigationBarDrawer(displayMode: .always)`).
import './ui.css';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type MutableRefObject, type Ref } from 'react';
import { Icon } from './Icon';
import { Spinner } from './Spinner';
import { useKeyboardInset } from './useKeyboardInset';

function setRef<T>(ref: Ref<T> | undefined, v: T | null) {
  if (!ref) return;
  if (typeof ref === 'function') ref(v);
  else (ref as MutableRefObject<T | null>).current = v;
}

function useInputRef(el: MutableRefObject<HTMLInputElement | null>, inputRef: Ref<HTMLInputElement> | undefined) {
  return useCallback(
    (n: HTMLInputElement | null) => {
      el.current = n;
      setRef(inputRef, n);
    },
    [el, inputRef],
  );
}

/** Focus without scrolling the (position:fixed) document; iOS only shows the keyboard inside a user gesture. */
function useAutoFocus(el: MutableRefObject<HTMLInputElement | null>, on: boolean | undefined) {
  useEffect(() => {
    if (!on) return;
    const node = el.current;
    if (!node) return;
    node.focus({ preventScroll: true });
    // a sheet may still be animating in: retry once after the frame
    const raf = requestAnimationFrame(() => {
      if (document.activeElement !== node) node.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [el, on]);
}

/* ───────────────────────────── (a) CordSearchField ───────────────────────────── */

export interface CordSearchFieldProps {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  /** Trailing small spinner. */
  loading?: boolean;
  /** xmark.circle.fill clear button when non-empty and not loading (QuickSwitcher only). */
  clearable?: boolean;
  autoFocus?: boolean;
  onSubmit?: () => void;
  inputRef?: Ref<HTMLInputElement>;
  /** Outer wrapper style (the three iOS call sites use different outer padding). */
  style?: CSSProperties;
  // additions
  ariaLabel?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  /** iOS default is sentence case (the iOS fields only disable autocorrection). */
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}

/** Custom Cord search field: magnifyingglass + 17px input, padding 10, --bg-input, radius --radius. */
export function CordSearchField({
  value,
  onChange,
  placeholder,
  loading,
  clearable,
  autoFocus,
  onSubmit,
  inputRef,
  style,
  ariaLabel,
  onFocus,
  onBlur,
  autoCapitalize = 'sentences',
}: CordSearchFieldProps) {
  const el = useRef<HTMLInputElement | null>(null);
  const attach = useInputRef(el, inputRef);
  useAutoFocus(el, autoFocus);
  return (
    <div style={style}>
      <div className="ios-search-field" onClick={() => el.current?.focus({ preventScroll: true })}>
        <span className="ios-search-field-icon">
          <Icon name="magnifyingglass" size={20} />
        </span>
        <input
          ref={attach}
          type="search"
          value={value}
          placeholder={placeholder}
          aria-label={ariaLabel ?? placeholder}
          autoComplete="off"
          autoCapitalize={autoCapitalize}
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          onFocus={onFocus}
          onBlur={onBlur}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onSubmit?.();
            }
          }}
        />
        {loading ? (
          <Spinner size="small" />
        ) : clearable && value ? (
          <button
            type="button"
            className="ios-search-clear"
            aria-label="Clear"
            onPointerDown={(e) => e.preventDefault() /* keep the keyboard up */}
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
              el.current?.focus({ preventScroll: true });
            }}
          >
            <Icon name="xmark.circle.fill" size={20} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* ───────────────────────────── (b) SearchCapsule ───────────────────────────── */

export interface SearchCapsuleProps {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  /** 'bottom' = iOS 26 floating glass capsule above the home indicator; 'drawer' = under the nav bar. */
  placement?: 'bottom' | 'drawer';
  // additions
  autoFocus?: boolean;
  onSubmit?: () => void;
  inputRef?: Ref<HTMLInputElement>;
  ariaLabel?: string;
  /**
   * 'bottom' only: also render an in-flow spacer (default true) so the last rows can scroll above the capsule.
   * Render the SearchCapsule as the LAST child of the scroll content (or pass spacer={false} and pad yourself
   * with var(--ios-search-capsule-space)).
   */
  spacer?: boolean;
  /** Called with true/false when the field gains/loses focus (iOS "isSearching"). */
  onActiveChange?: (active: boolean) => void;
  style?: CSSProperties;
}

/**
 * System `.searchable` look.
 * 'bottom': a position:fixed glass capsule (x 28.5…W−28.5, 46 tall, 29 above the bottom edge on Face-ID phones);
 * it follows the nearest transformed ancestor (sheet / pushed screen), rises above the keyboard, and while focused
 * widens to 16px margins with a round glass xmark button that clears + dismisses the search.
 */
export function SearchCapsule({
  value,
  onChange,
  placeholder,
  placement = 'bottom',
  autoFocus,
  onSubmit,
  inputRef,
  ariaLabel,
  spacer = true,
  onActiveChange,
  style,
}: SearchCapsuleProps) {
  const el = useRef<HTMLInputElement | null>(null);
  const attach = useInputRef(el, inputRef);
  const [focused, setFocused] = useState(false);
  const kb = useKeyboardInset();
  useAutoFocus(el, autoFocus);

  const setActive = (on: boolean) => {
    setFocused(on);
    onActiveChange?.(on);
  };

  const capsule = (
    <label className="ios-search-capsule">
      <span className="ios-search-capsule-icon">
        <Icon name="magnifyingglass" size={22} />
      </span>
      <input
        ref={attach}
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        onFocus={() => setActive(true)}
        onBlur={() => setActive(false)}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSubmit?.();
            el.current?.blur();
          } else if (e.key === 'Escape') {
            el.current?.blur();
          }
        }}
      />
      {value && (
        <button
          type="button"
          className="ios-search-clear"
          aria-label="Clear"
          onPointerDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault();
            onChange('');
            el.current?.focus({ preventScroll: true });
          }}
        >
          <Icon name="xmark.circle.fill" size={20} />
        </button>
      )}
    </label>
  );

  if (placement === 'drawer') {
    return (
      <div className="ios-search-drawer" style={style}>
        {capsule}
      </div>
    );
  }

  return (
    <>
      {spacer && <div className="ios-search-capsule-spacer" aria-hidden />}
      <div
        className={'ios-search-dock' + (focused ? ' is-focused' : '') + (kb > 0 ? ' is-kb' : '')}
        style={{ ...style, ['--kb' as string]: `${kb}px` }}
      >
        {capsule}
        {focused && (
          <button
            type="button"
            className="ios-search-cancel"
            aria-label="Cancel"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange('');
              el.current?.blur();
            }}
          >
            <Icon name="xmark" size={20} strokeWidth={2.2} />
          </button>
        )}
      </div>
    </>
  );
}
