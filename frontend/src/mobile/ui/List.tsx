// iOS 26 List family (inset-grouped and plain).
// Usage notes for screen authors:
// • Rows must be direct children of <ListSection> (fragments / .map are fine), wrapped by <SwipeRow>, or
//   wrapped in an element with class "ios-cell" — otherwise the "no separator after the last row" rule
//   cannot see them.
// • Separator leading inset: icon rows 56, plain rows 16, rows with `leading` → aligned to the title text
//   (measured). iOS quirk: rows whose first element is an initials Avatar align the separator to the
//   initials (≈22) → pass `separatorInset={22}` there.
// • <InsetGroupedList> expects to start at the nav-bar bottom (inline screens) or the large-title row bottom
//   (large-title screens: pass top="large", or have an ancestor with data-title-mode="large").
import './ui.css';
import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { Icon, type SFSymbol } from './Icon';
import type { Route } from '../nav/routes';
import { useNav } from '../nav/NavStack';
import { usePresent } from '../present/PresentationProvider';
import { Switch } from './Switch';
import { Spinner } from './Spinner';
import { ROW_INTERACTIVE, usePressHighlight } from './press';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
const has = (n: ReactNode) => n !== undefined && n !== null && n !== false && n !== '';

/* ───────────────────────────── containers ───────────────────────────── */

/** iOS inset-grouped List container (page bg = --bg-primary; sections = --bg-secondary cards). */
export function InsetGroupedList({
  children,
  style,
  top,
  className,
}: {
  children?: ReactNode;
  style?: CSSProperties;
  /**
   * Gap above the first section: 'inline' (default: bar+45, first header bar+20), 'large' (10 below the
   * large-title row), 'none' (0). Default follows an ancestor `data-title-mode="large"` if present.
   */
  top?: 'inline' | 'large' | 'none';
  className?: string;
}) {
  return (
    <div className={cx('ios-list-inset', className)} data-top={top} style={style}>
      {children}
    </div>
  );
}

/** iOS `.listStyle(.plain)`: full-width rows, sticky section headers. */
export function PlainList({ children, style, className }: { children?: ReactNode; style?: CSSProperties; className?: string }) {
  return (
    <div className={cx('ios-plain-list', className)} style={style}>
      {children}
    </div>
  );
}

export interface ListSectionProps {
  /** iOS 26: 17px semibold, --text-muted, NOT uppercased. */
  header?: ReactNode;
  /** Trailing control in the header row (e.g. "+" MenuButton). */
  headerAccessory?: ReactNode;
  /** 13px footnote below the card. */
  footer?: ReactNode;
  /** No card background (spinner/hint rows). */
  clear?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
  /** Style of the rounded card (e.g. custom padding for non-row content). */
  cardStyle?: CSSProperties;
  className?: string;
}

export function ListSection({ header, headerAccessory, footer, clear, children, style, cardStyle, className }: ListSectionProps) {
  const hasHeader = has(header) || has(headerAccessory);
  return (
    <section className={cx('ios-section', hasHeader && 'has-header', clear && 'is-clear', className)} style={style}>
      {hasHeader && (
        <div className="ios-section-header">
          <span className="ios-section-header-text" role="heading" aria-level={2}>
            {header}
          </span>
          {has(headerAccessory) && <span className="ios-section-header-accessory">{headerAccessory}</span>}
        </div>
      )}
      <div className="ios-section-card" style={cardStyle}>
        {children}
      </div>
      {has(footer) && <div className="ios-section-footer">{footer}</div>}
    </section>
  );
}

/* ───────────────────────────── row ───────────────────────────── */

/** System disclosure indicator (`chevron.right`, 7×12 glyph, --ios-label-3). */
export function Disclosure({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg className={cx('ios-row-chevron', className)} style={style} viewBox="0 0 8 14" aria-hidden focusable={false}>
      <path d="M1.5 2 6.5 7l-5 5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export interface RowProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Leading view (Avatar, custom icon). Mutually exclusive with `icon`. */
  leading?: ReactNode;
  /** Label-row icon (24px column, title at 56px). */
  icon?: SFSymbol;
  /** Icon colour; default = title colour. */
  iconColor?: string;
  trailing?: ReactNode;
  onPress?: (e: MouseEvent<HTMLElement>) => void;
  /** System disclosure chevron (NavigationLink). */
  chevron?: boolean;
  /** Gray count (0/undefined → hidden). */
  badge?: number;
  /** 'before' the chevron (badge inside the label: DM rows) or 'after' it (server/channel rows). */
  badgePosition?: 'before' | 'after';
  /** Separator leading inset from the section's left edge (default: 56 with icon, 16 otherwise). */
  separatorInset?: number;
  /** Default var(--text-primary). */
  titleColor?: string;
  titleStyle?: CSSProperties;
  /** Clamp subtitle to N lines (default: no clamp). */
  subtitleLines?: number;
  disabled?: boolean;
  /** Row background override (default var(--bg-secondary) inside inset lists). */
  bg?: string;
  /** Custom content instead of title/subtitle. */
  children?: ReactNode;
  style?: CSSProperties;
  ariaLabel?: string;
  // ── additions (optional) ──
  /** Clamp the title to N lines (default: wraps freely, like SwiftUI Text). */
  titleLines?: number;
  /** Subtitle style (default 12px --text-muted). */
  subtitleStyle?: CSSProperties;
  /** Gap between `leading` and the text (default 12; iOS server/DM rows use 10). */
  leadingGap?: number;
  /** false → no separator below this row. */
  separator?: boolean;
  /** Press highlight (default: on when `onPress` is set). */
  highlight?: boolean;
  /** Vertical alignment of leading/trailing (default 'center'). */
  align?: 'center' | 'top';
  className?: string;
  /**
   * Accessibility role of a pressable row (default 'button'). 'none' = the row is only a bigger tap target for a
   * nested control that carries the semantics itself (ToggleRow → its Switch): not focusable, no role.
   */
  a11yRole?: 'button' | 'radio' | 'checkbox' | 'none';
  /** aria-checked for a11yRole 'radio' / 'checkbox'. */
  ariaChecked?: boolean;
}

/** Pass `bg="clear"` for `.listRowBackground(Color.clear)` (shows the page background). */
function resolveBg(bg: string | undefined): string | undefined {
  if (!bg) return undefined;
  if (bg === 'clear') return 'var(--ios-page-bg, var(--ios-screen-bg, var(--bg-primary)))';
  return bg;
}

function clampProps(lines: number | undefined, base: string): { className: string; style?: CSSProperties } {
  if (!lines || lines < 1) return { className: base };
  if (lines === 1) return { className: `${base} ios-clamp-1` };
  return { className: `${base} ios-clamp`, style: { WebkitLineClamp: lines } };
}

export function Row(props: RowProps) {
  const {
    title,
    subtitle,
    leading,
    icon,
    iconColor,
    trailing,
    onPress,
    chevron,
    badge,
    badgePosition = 'before',
    separatorInset,
    titleColor,
    titleStyle,
    subtitleLines,
    disabled,
    bg,
    children,
    style,
    ariaLabel,
    titleLines,
    subtitleStyle,
    leadingGap,
    separator = true,
    highlight,
    align = 'center',
    className,
    a11yRole = 'button',
    ariaChecked,
  } = props;

  const rowRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const leadingRef = useRef<HTMLSpanElement>(null);
  const pressable = !!onPress && !disabled;
  const press = usePressHighlight(pressable && highlight !== false);
  const hasLeading = !icon && has(leading);

  // Separator with a custom leading view: SwiftUI aligns it to the row's FIRST Text. That is the title, except when
  // the row starts with an initials avatar (RemoteAvatar without a loaded image) — then it is the initials inside
  // the circle (≈22 from the section edge for a 28 avatar). Re-measured when the avatar image loads.
  useLayoutEffect(() => {
    const row = rowRef.current;
    const lead = leadingRef.current;
    // explicit inset / icon / plain rows: React's style prop owns --sep-inset
    if (!row || !lead || separatorInset != null || !hasLeading) return;
    let last = '';
    const offsetIn = (el: HTMLElement | null): number | null => {
      let x = 0;
      while (el && el !== row) {
        x += el.offsetLeft;
        el = el.offsetParent as HTMLElement | null;
      }
      return el === row ? x : null;
    };
    const measure = () => {
      let first = lead.firstElementChild as HTMLElement | null;
      while (first && !first.classList.contains('ios-avatar') && first.firstElementChild) first = first.firstElementChild as HTMLElement;
      const initials =
        first?.classList.contains('ios-avatar') && !first.classList.contains('is-loaded')
          ? (first.querySelector('.ios-avatar-initials') as HTMLElement | null)
          : null;
      const x = (initials && initials.textContent ? offsetIn(initials) : null) ?? bodyRef.current?.offsetLeft ?? null;
      if (x == null || x <= 0) return;
      const v = `${Math.round(x * 2) / 2}px`;
      if (v !== last) {
        last = v;
        row.style.setProperty('--sep-inset', v);
      }
    };
    measure();
    const mo = new MutationObserver(measure);
    mo.observe(lead, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    // rows first laid out while hidden (display:none tab / pane) measure 0 → re-measure once they get a size
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (bodyRef.current) ro?.observe(bodyRef.current);
    return () => {
      mo.disconnect();
      ro?.disconnect();
    };
  }, [separatorInset, hasLeading, leadingGap]);

  const sepInset = separatorInset != null ? separatorInset : icon ? 56 : hasLeading ? undefined : 16;
  const rowStyle: CSSProperties & Record<string, string | number | undefined> = { ...style };
  if (sepInset != null) rowStyle['--sep-inset'] = `${sepInset}px`;
  const rowBg = resolveBg(bg);
  if (rowBg) rowStyle['--ios-row-bg'] = rowBg;

  const showBadge = typeof badge === 'number' && badge > 0;
  const tColor = titleColor ?? 'var(--text-primary)';

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!pressable) return;
    // a click on a nested control (trailing button, MenuButton, pill…) belongs to that control
    const inner = (e.target as Element | null)?.closest?.(ROW_INTERACTIVE);
    if (inner && inner !== e.currentTarget && e.currentTarget.contains(inner)) return;
    onPress?.(e);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!pressable || e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      (e.currentTarget as HTMLElement).click();
    }
  };

  const titleClamp = clampProps(titleLines, 'ios-row-title');
  const subClamp = clampProps(subtitleLines, 'ios-row-subtitle');

  return (
    <div
      ref={rowRef}
      className={cx(
        'ios-row',
        pressable && 'is-pressable',
        disabled && 'is-disabled',
        !separator && 'no-separator',
        align === 'top' && 'is-top',
        className,
      )}
      style={rowStyle}
      role={onPress && a11yRole !== 'none' ? a11yRole : undefined}
      tabIndex={onPress && !disabled && a11yRole !== 'none' ? 0 : undefined}
      aria-disabled={onPress && disabled && a11yRole !== 'none' ? true : undefined}
      aria-checked={onPress && (a11yRole === 'radio' || a11yRole === 'checkbox') ? !!ariaChecked : undefined}
      aria-label={ariaLabel}
      onClick={onPress ? onClick : undefined}
      onKeyDown={onPress ? onKeyDown : undefined}
      {...press}
    >
      {icon && (
        <span className="ios-row-icon" style={{ color: iconColor ?? tColor }}>
          <Icon name={icon} size={24} />
        </span>
      )}
      {hasLeading && (
        <span ref={leadingRef} className="ios-row-leading" style={{ marginRight: leadingGap ?? 12 }}>
          {leading}
        </span>
      )}
      <div ref={bodyRef} className="ios-row-body">
        {children ?? (
          <>
            {has(title) && (
              <div className={titleClamp.className} style={{ color: tColor, ...titleClamp.style, ...titleStyle }}>
                {title}
              </div>
            )}
            {has(subtitle) && (
              <div className={subClamp.className} style={{ ...subClamp.style, ...subtitleStyle }}>
                {subtitle}
              </div>
            )}
          </>
        )}
      </div>
      {has(trailing) && <div className="ios-row-trailing">{trailing}</div>}
      {showBadge && badgePosition === 'before' && <span className="ios-row-badge is-before">{badge}</span>}
      {chevron && <Disclosure className={!has(trailing) && !(showBadge && badgePosition === 'before') ? 'is-first' : undefined} />}
      {showBadge && badgePosition === 'after' && (
        <span className={cx('ios-row-badge', chevron ? 'is-after' : 'is-before')}>{badge}</span>
      )}
    </div>
  );
}

/** Row with a disclosure chevron that pushes `to` (or runs onPress). */
export function NavRow(props: RowProps & { to?: Route }) {
  const { to, onPress, ...rest } = props;
  const nav = useNav();
  const handle =
    to || onPress
      ? (e: MouseEvent<HTMLElement>) => {
          onPress?.(e);
          if (to && !e.defaultPrevented) nav.push(to);
        }
      : undefined;
  return <Row chevron {...rest} onPress={handle} />;
}

/* ───────────────────────────── button row ───────────────────────────── */

export interface ButtonRowProps {
  title: string;
  icon?: SFSymbol;
  onPress: (e: MouseEvent<HTMLElement>) => void;
  /** 'destructive' → --ios-red (#FF4245); 'danger' → var(--danger) (theme); default → tint (accent). */
  role?: 'default' | 'destructive' | 'danger';
  /** Explicit colour override (e.g. var(--text-primary) for Label rows with foregroundStyle). */
  color?: string;
  disabled?: boolean;
  busy?: boolean;
  align?: 'leading' | 'center';
  // additions
  /** Icon colour when it differs from the title (default = title colour). */
  iconColor?: string;
  subtitle?: ReactNode;
  separatorInset?: number;
}

export function ButtonRow({ title, icon, onPress, role = 'default', color, disabled, busy, align = 'leading', iconColor, subtitle, separatorInset }: ButtonRowProps) {
  const c =
    color ?? (role === 'destructive' ? 'var(--ios-red)' : role === 'danger' ? 'var(--danger)' : 'var(--tint, var(--accent))');
  return (
    <Row
      icon={icon}
      iconColor={iconColor ?? c}
      title={title}
      titleColor={c}
      subtitle={subtitle}
      separatorInset={separatorInset}
      disabled={disabled}
      onPress={busy ? undefined : onPress}
      trailing={busy ? <Spinner /> : undefined}
      className={align === 'center' ? 'is-center-title' : undefined}
    />
  );
}

/* ───────────────────────────── toggle row ───────────────────────────── */

export interface ToggleRowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  // additions
  icon?: SFSymbol;
  iconColor?: string;
  /** Spinner before the switch (e.g. while the setting saves). */
  busy?: boolean;
  separatorInset?: number;
}

/** Label (17px + optional 12px muted caption, spacing 2) + iOS 26 switch; the whole row toggles. */
export function ToggleRow({ title, subtitle, checked, onChange, disabled, icon, iconColor, busy, separatorInset }: ToggleRowProps) {
  return (
    <Row
      icon={icon}
      iconColor={iconColor}
      title={title}
      subtitle={subtitle}
      separatorInset={separatorInset}
      disabled={disabled}
      highlight={false}
      a11yRole="none"
      onPress={disabled ? undefined : () => onChange(!checked)}
      trailing={
        <>
          {busy && <Spinner />}
          <Switch
            checked={checked}
            onChange={onChange}
            disabled={disabled}
            ariaLabel={typeof title === 'string' ? title : undefined}
            className="ios-row-switch"
          />
        </>
      }
    />
  );
}

/* ───────────────────────────── value row ───────────────────────────── */

export interface ValueRowProps {
  title: ReactNode;
  value?: ReactNode;
  onPress?: (e: MouseEvent<HTMLElement>) => void;
  /** Default --ios-label-2. Appearance "Темы" row uses var(--text-muted). */
  valueColor?: string;
  /** 'system' disclosure (default; shown only when the row has onPress) or 'muted' caption-size chevron in --text-muted. */
  chevronStyle?: 'system' | 'muted' | 'none';
  // additions
  icon?: SFSymbol;
  iconColor?: string;
  subtitle?: ReactNode;
  disabled?: boolean;
  separatorInset?: number;
}

export function ValueRow({ title, value, onPress, valueColor, chevronStyle = 'system', icon, iconColor, subtitle, disabled, separatorInset }: ValueRowProps) {
  const hasValue = has(value);
  return (
    <Row
      icon={icon}
      iconColor={iconColor}
      title={title}
      subtitle={subtitle}
      separatorInset={separatorInset}
      disabled={disabled}
      onPress={onPress}
      chevron={chevronStyle === 'system' && !!onPress}
      trailing={
        hasValue || chevronStyle === 'muted' ? (
          <>
            {hasValue && (
              <span className="ios-row-value" style={{ color: valueColor ?? 'var(--ios-label-2)' }}>
                {value}
              </span>
            )}
            {chevronStyle === 'muted' && <Disclosure className="is-muted" />}
          </>
        ) : undefined
      }
    />
  );
}

/* ───────────────────────────── picker row ───────────────────────────── */

export interface PickerRowProps<T extends string> {
  title: ReactNode;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  // additions
  icon?: SFSymbol;
  iconColor?: string;
  /** Value/indicator colour (default tint = accent). */
  tint?: string;
  separatorInset?: number;
}

/** Menu-style Picker in a List: value + chevron.up.chevron.down in tint; tap opens a checkmark Menu. */
export function PickerRow<T extends string>({ title, value, options, onChange, disabled, icon, iconColor, tint, separatorInset }: PickerRowProps<T>) {
  const present = usePresent();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const label = options.find((o) => o.value === value)?.label ?? '';
  const open = (e: MouseEvent<HTMLElement>) => {
    const anchor = anchorRef.current ?? (e.currentTarget as HTMLElement);
    present.showMenu(
      anchor,
      options.map((o) => ({
        label: o.label,
        checked: o.value === value,
        onSelect: () => {
          if (o.value !== value) onChange(o.value);
        },
      })),
    );
  };
  return (
    <Row
      icon={icon}
      iconColor={iconColor}
      title={title}
      separatorInset={separatorInset}
      disabled={disabled}
      onPress={disabled ? undefined : open}
      trailing={
        <span ref={anchorRef} className="ios-row-picker-value" style={tint ? { color: tint } : undefined}>
          <span className="ios-row-value">{label}</span>
          <Icon name="chevron.up.chevron.down" size={15} strokeWidth={2.2} />
        </span>
      }
    />
  );
}

/* ───────────────────────────── check / radio rows ───────────────────────────── */

export interface CheckRowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  checked: boolean;
  onPress: () => void;
  // additions
  leading?: ReactNode;
  icon?: SFSymbol;
  separatorInset?: number;
  disabled?: boolean;
}

/** Trailing accent checkmark when selected (Language, theme list). */
export function CheckRow({ title, subtitle, checked, onPress, leading, icon, separatorInset, disabled }: CheckRowProps) {
  return (
    <Row
      title={title}
      subtitle={subtitle}
      leading={leading}
      icon={icon}
      separatorInset={separatorInset}
      disabled={disabled}
      onPress={() => onPress()}
      a11yRole="radio"
      ariaChecked={checked}
      ariaLabel={typeof title === 'string' ? title : undefined}
      trailing={checked ? <Icon name="checkmark" size={22} strokeWidth={2.3} color="var(--tint, var(--accent))" /> : undefined}
    />
  );
}

export interface RadioRowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}

/** Leading largecircle.fill.circle (accent) / circle (muted) + title + caption (Notifications level). */
export function RadioRow({ title, subtitle, selected, onPress, disabled }: RadioRowProps) {
  return (
    <Row
      align="top"
      leadingGap={12}
      leading={
        <span className="ios-row-radio" aria-hidden>
          <Icon
            name={selected ? 'largecircle.fill.circle' : 'circle'}
            size={19}
            strokeWidth={1.9}
            color={selected ? 'var(--tint, var(--accent))' : 'var(--text-muted)'}
          />
        </span>
      }
      title={title}
      subtitle={subtitle}
      disabled={disabled}
      a11yRole="radio"
      ariaChecked={selected}
      onPress={() => onPress()}
    />
  );
}

/* ───────────────────────────── utility rows ───────────────────────────── */

/** Centred spinner row (clear background). */
export function SpinnerRow({ clear = true, size }: { clear?: boolean; size?: 'regular' | 'small' | 'mini' } = {}) {
  return (
    <Row bg={clear ? 'clear' : undefined} className="is-center" separator={false}>
      <Spinner size={size} />
    </Row>
  );
}

/** Footnote text in var(--danger) as its own row/section. */
export function ErrorRow({ text }: { text: ReactNode }) {
  return (
    <Row>
      <div className="ios-row-error">{text}</div>
    </Row>
  );
}

/** Single muted row ("Нет серверов", "Пока пусто"…). */
export function EmptyRow({ text }: { text: ReactNode }) {
  return (
    <Row>
      <div className="ios-row-title ios-row-empty">{text}</div>
    </Row>
  );
}
