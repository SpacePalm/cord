// Shared pieces of the admin panel (iOS Cord/Features/Admin/AdminSupport.swift + small list helpers).
// Chrome metrics follow iOS 26.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type Ref,
  type TouchEvent,
} from 'react';
import { ApiError } from '../../../api/client';
import { mt } from '../../i18n';
import { CordField, Icon, InsetGroupedList, ListSection, Row, Spinner } from '../../ui';
import { MenuButton } from '../../present/MenuButton';
import type { MenuItem } from '../../present/PresentationProvider';
import { formatBytes } from '../settings/StorageScreen';
import './admin.css';

/* ───────────────────────────── formatting (AdminFmt) ───────────────────────────── */

function addMonthsClamped(d: Date, months: number): Date {
  const r = new Date(d.getTime());
  const day = r.getDate();
  r.setDate(1);
  r.setMonth(r.getMonth() + months);
  const last = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(day, last));
  return r;
}

/** Calendar-aware whole months between two dates (truncated toward zero, signed: a − b). */
function diffMonths(a: Date, b: Date): number {
  const sign = a.getTime() < b.getTime() ? -1 : 1;
  const late = sign > 0 ? a : b;
  const early = sign > 0 ? b : a;
  let m = (late.getFullYear() - early.getFullYear()) * 12 + (late.getMonth() - early.getMonth());
  if (m > 0 && addMonthsClamped(early, m).getTime() > late.getTime()) m -= 1;
  return sign * m;
}

const trunc = (v: number) => (v < 0 ? Math.ceil(v) : Math.floor(v));

/**
 * `RelativeDateTimeFormatter(unitsStyle: .short)` — the largest non-zero calendar unit, truncated:
 * RU "через 5 мин." / "3 дн. назад", EN "in 5 min." / "1 wk. ago"; Δ = 0 → "через 0 сек.".
 */
export function relativeLikeIOS(iso: string, locale: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const fmt = new Intl.RelativeTimeFormat(locale, { style: 'short', numeric: 'always' });
  const months = diffMonths(d, now);
  const years = trunc(months / 12);
  const ms = d.getTime() - now.getTime();
  const days = trunc(ms / 86_400_000);
  const weeks = trunc(days / 7);
  const hours = trunc(ms / 3_600_000);
  const minutes = trunc(ms / 60_000);
  const seconds = trunc(ms / 1000);
  const pick: [number, Intl.RelativeTimeFormatUnit][] = [
    [years, 'year'],
    [months, 'month'],
    [weeks, 'week'],
    [days, 'day'],
    [hours, 'hour'],
    [minutes, 'minute'],
    [seconds, 'second'],
  ];
  for (const [n, unit] of pick) if (n !== 0) return fmt.format(n, unit);
  return fmt.format(0, 'second');
}

/** `DateFormatter(dateStyle: .short, timeStyle: .short)` → "08.10.2026, 14:03" / "10/8/26, 2:03 PM". */
export function dateTimeShort(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(d);
}

/** `ByteCountFormatter(.file)` — decimal units ("84,2 МБ", "Ноль КБ"). Shared with Settings → Storage. */
export function bytesLikeIOS(n: number, locale: string): string {
  return formatBytes(n, locale);
}

/** Block durations in iOS `BlockDuration` order (null = permanent → field omitted). */
export const BLOCK_DURATIONS: { key: string; seconds: number | null }[] = [
  { key: 'admin.duration.hour', seconds: 3600 },
  { key: 'admin.duration.day', seconds: 86_400 },
  { key: 'admin.duration.week', seconds: 604_800 },
  { key: 'admin.duration.month', seconds: 2_592_000 },
  { key: 'admin.duration.permanent', seconds: null },
];

/* ───────────────────────────── errors (APIError.userMessage) ───────────────────────────── */

/**
 * iOS `APIError.userMessage(default:)` + the non-API `common.errorPrefix` branch:
 * string detail → verbatim; 422 validation array → first item's msg; anything else → fallback.
 * Non-API errors (fetch TypeError…) → "Ошибка: <message>".
 */
export function apiErrorText(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    const d = e.detail;
    if (typeof d === 'string') return d.trim() && d !== 'Unknown error' ? d : fallback;
    if (Array.isArray(d)) {
      const first = d[0] as { msg?: unknown } | undefined;
      return typeof first?.msg === 'string' && first.msg ? first.msg : fallback;
    }
    return fallback;
  }
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return mt('common.errorPrefix', msg);
}

/* ───────────────────────────── hooks ───────────────────────────── */

export interface TransientMessage {
  text: string;
  isError: boolean;
}

/** Shared status line: errors persist (until replaced), successes auto-hide after `ms` (token-guarded). */
export function useTransientMessage(ms = 3000) {
  const [message, setMessage] = useState<TransientMessage | null>(null);
  const token = useRef(0);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    },
    [],
  );
  const show = useCallback(
    (text: string, isError: boolean) => {
      setMessage({ text, isError });
      const my = ++token.current;
      if (timer.current != null) window.clearTimeout(timer.current);
      timer.current = null;
      if (!isError) {
        timer.current = window.setTimeout(() => {
          if (token.current === my) setMessage(null);
        }, ms);
      }
    },
    [ms],
  );
  return { message, show };
}

/** Set of ids with an operation in flight (iOS `busy: Set<String>`). */
export function useBusySet() {
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const add = useCallback((id: string) => setBusy((s) => new Set(s).add(id)), []);
  const remove = useCallback(
    (id: string) =>
      setBusy((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      }),
    [],
  );
  return { busy, add, remove };
}

/** True once the component has unmounted (async results must not touch state after leaving a tab). */
export function useAlive() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}

/* ───────────────────────────── shared views ───────────────────────────── */

/** AdminBadge: caption2 semibold capsule, 18% tint of its colour. */
export function AdminBadge({ text, color }: { text: string; color: string }) {
  return (
    <span className="m-adm-badge" style={{ color, background: `color-mix(in srgb, ${color} 18%, transparent)` }}>
      {text}
    </span>
  );
}

/** AdminMessage as the only row of its own card: footnote, --danger on error else --text-secondary. */
export function AdminMessageSection({ message }: { message: TransientMessage | null }) {
  if (!message) return null;
  return (
    <ListSection>
      <Row>
        <div
          className="m-adm-msg ios-selectable"
          role={message.isError ? 'alert' : 'status'}
          style={{ color: message.isError ? 'var(--danger)' : 'var(--text-secondary)' }}
        >
          {message.text}
        </div>
      </Row>
    </ListSection>
  );
}

/** AdminStatCard: value title2 bold (tabular) over a caption label, --bg-tertiary, radius --radius. */
export function AdminStatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="m-adm-stat">
      <div className="m-adm-stat-value">{value}</div>
      <div className="m-adm-stat-label">{label}</div>
    </div>
  );
}

/** Centred spinner row (`HStack { Spacer(); ProgressView(); Spacer() }`), clear or inside the card. */
export function CenterSpinnerRow({ clear, padY }: { clear?: boolean; padY?: number }) {
  return (
    <Row bg={clear ? 'clear' : undefined} className="is-center" separator={!clear}>
      <span style={padY ? { padding: `${padY}px 0`, display: 'flex' } : { display: 'flex' }}>
        <Spinner />
      </span>
    </Row>
  );
}

/** Body-size muted text row; `center` = clear centred (empty People/Servers), else left in the card. */
export function MutedTextRow({ text, center }: { text: string; center?: boolean }) {
  return (
    <Row bg={center ? 'clear' : undefined} className={center ? 'is-center' : undefined} separator={!center}>
      <div className="m-adm-muted-text" style={center ? { textAlign: 'center' } : undefined}>
        {text}
      </div>
    </Row>
  );
}

/** Section S1 of People / Servers: clear row with insets 8/12/8/12 holding a CordField. */
export function SearchSection({ placeholder, value, onChange }: { placeholder: string; value: string; onChange: (v: string) => void }) {
  return (
    <ListSection clear>
      <div className="ios-cell m-adm-search-cell">
        <CordField
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          enterKeyHint="search"
          onSubmit={blurActive}
          ariaLabel={placeholder}
        />
      </div>
    </ListSection>
  );
}

/** CordField as a default-inset list row (inside a card). */
export function FieldRow({
  placeholder,
  value,
  onChange,
  inputMode,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  inputMode?: 'text' | 'numeric';
}) {
  return (
    <Row>
      <CordField placeholder={placeholder} value={value} onChange={onChange} inputMode={inputMode} onSubmit={blurActive} />
    </Row>
  );
}

/** Number row: label left, plain right-aligned numeric field (+ optional unit text). */
export function NumberFieldRow({
  title,
  value,
  onChange,
  width,
  unit,
  placeholder,
  locale,
}: {
  title: string;
  value: number;
  onChange: (n: number) => void;
  width: number;
  unit?: string;
  placeholder?: string;
  locale: string;
}) {
  return (
    <Row
      title={title}
      className="m-adm-row"
      trailing={
        <span className="m-adm-num-wrap">
          <GroupedNumberInput value={value} onChange={onChange} width={width} placeholder={placeholder} ariaLabel={title} locale={locale} />
          {unit && <span className="m-adm-num-unit">{unit}</span>}
        </span>
      }
    />
  );
}

/** Numeric input with the app locale's grouping while not focused (RU "3 600", EN "3,600"). */
function GroupedNumberInput({
  value,
  onChange,
  width,
  placeholder,
  ariaLabel,
  locale,
}: {
  value: number;
  onChange: (n: number) => void;
  width: number;
  placeholder?: string;
  ariaLabel?: string;
  locale: string;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const shown = editing ?? new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
  return (
    <input
      className="m-adm-num"
      style={{ width }}
      type="text"
      inputMode="numeric"
      enterKeyHint="done"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={shown}
      onFocus={() => setEditing(String(value))}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^\d]/g, '');
        setEditing(raw);
        if (raw !== '') {
          const n = Number(raw);
          if (Number.isSafeInteger(n)) onChange(n);
        }
      }}
      onBlur={() => setEditing(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/** ⋯ (`ellipsis.circle`, --text-muted) Menu trigger with a 44×44 hit area. */
export function MoreMenu({ items, ariaLabel, btnRef }: { items: MenuItem[] | (() => MenuItem[]); ariaLabel: string; btnRef?: Ref<HTMLButtonElement> }) {
  return (
    <MenuButton items={items}>
      <button type="button" className="m-adm-more" aria-label={ariaLabel} ref={btnRef}>
        <Icon name="ellipsis.circle" size={24} strokeWidth={1.5} />
      </button>
    </MenuButton>
  );
}

/** Small accent glyph button in a section header (`arrow.clockwise` caption) with a 44×44 hit area. */
export function HeaderRefreshButton({ onPress, disabled, ariaLabel }: { onPress: () => void; disabled?: boolean; ariaLabel: string }) {
  return (
    <button type="button" className="m-adm-hdr-btn" aria-label={ariaLabel} disabled={disabled} onClick={() => onPress()}>
      <Icon name="arrow.clockwise" size={15} strokeWidth={2.4} />
    </button>
  );
}

/** Plain text button (caption, colour given) — locked-account "Разблокировать", log "Разблокировать". */
export function TextButton({
  children,
  color,
  onPress,
  ariaLabel,
}: {
  children: ReactNode;
  color: string;
  onPress?: (e: MouseEvent<HTMLButtonElement>) => void;
  ariaLabel?: string;
}) {
  return (
    <button type="button" className="m-adm-textbtn" style={{ color }} aria-label={ariaLabel} onClick={onPress}>
      {children}
    </button>
  );
}

/** Plain icon button (trash / kick) in --danger, 44×44 hit area around a 24 box. */
export function IconButton({ icon, ariaLabel, onPress, color = 'var(--danger)' }: { icon: 'trash' | 'person.fill.xmark'; ariaLabel: string; onPress: () => void; color?: string }) {
  return (
    <button type="button" className="m-adm-iconbtn" style={{ color }} aria-label={ariaLabel} onClick={() => onPress()}>
      <Icon name={icon} size={22} strokeWidth={1.7} />
    </button>
  );
}

/** "Загрузить ещё" row: whole row tappable, centred accent text ↔ spinner. */
export function LoadMoreRow({ busy, onPress, label }: { busy: boolean; onPress: () => void; label: string }) {
  return (
    <Row className="is-center" onPress={busy ? undefined : () => onPress()} disabled={busy} ariaLabel={label}>
      {busy ? <Spinner /> : <div className="m-adm-loadmore">{label}</div>}
    </Row>
  );
}

/** The scroller of one admin tab: inset-grouped list, own scroll; dragging dismisses the keyboard. */
export function AdminList({ children, style, scrollRef }: { children: ReactNode; style?: CSSProperties; scrollRef?: Ref<HTMLDivElement> }) {
  return (
    <div className="m-adm-scroll" style={style} ref={scrollRef} onTouchMove={blurOnDrag}>
      <InsetGroupedList>{children}</InsetGroupedList>
      <div className="m-adm-bottom-spacer" />
    </div>
  );
}

/** Return key: resign the first responder (iOS CordField has no submit action in admin). */
export function blurActive(): void {
  const el = document.activeElement;
  if (el instanceof HTMLElement) el.blur();
}

function blurOnDrag(e: TouchEvent<HTMLDivElement>): void {
  const ae = document.activeElement;
  if (!(ae instanceof HTMLInputElement) || !e.currentTarget.contains(ae)) return;
  if (e.target instanceof Node && ae.contains(e.target)) return;
  ae.blur();
}

/** Debounced copy of a value (350ms like iOS `Task.sleep(.milliseconds(350))`). */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    if (Object.is(v, value)) return;
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms, v]);
  return v;
}
