// iOS 26 swipe actions.
// Swipe left reveals 60×44 capsules (gap 10, 10 from the trailing edge, vertically centred; icon-only, white
// ≈20pt; icon + label for rows ≥ 91px). The row content (with its own background) slides left over the page
// background; first declared action = rightmost. Rubber band past the buttons; full swipe (> 60% of the width)
// runs the first action. Closes on outside tap / any scroll; only one row is open at a time. Vertical scrolling
// stays native (touch-action: pan-y) and touches starting within 20px of the left edge are left to the
// screen's edge-swipe-back.
import './ui.css';
import { useEffect, useRef, type CSSProperties, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Icon, fillVariant, type SFSymbol } from './Icon';
import { haptic } from './haptics';
import { claimGesture, releaseGesture } from '../nav/gesture';

export interface SwipeAction {
  icon: SFSymbol;
  /** Accessible label; shown under the icon only for tall rows (≥91px). */
  label: string;
  /** Default var(--accent) (iOS 26: destructive also renders in the tint). */
  tint?: string;
  onPress: () => void;
}

export interface SwipeRowProps {
  /** First action = rightmost (closest to the trailing edge), as SwiftUI. */
  actions: SwipeAction[];
  /** Dragging far runs the first action (default true). */
  fullSwipe?: boolean;
  disabled?: boolean;
  children: ReactNode;
}

const PILL = 60;
const GAP = 10;
const EDGE_IGNORE = 20;
const LOCK = 8;
const FULL_RATIO = 0.6;
const TALL_ROW = 91;

/** The currently open row (only one at a time). */
let openRow: { close: (animated?: boolean) => void } | null = null;

/** Closes whichever swipe row is open (e.g. before presenting something). */
export function closeOpenSwipeRow(): void {
  openRow?.close(true);
}

type Track = 'idle' | 'pending' | 'h' | 'off';

export function SwipeRow({ actions, fullSwipe = true, disabled, children }: SwipeRowProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const live = useRef({ actions, fullSwipe, disabled });
  live.current = { actions, fullSwipe, disabled };

  const s = useRef({
    dx: 0,
    open: false,
    track: 'idle' as Track,
    id: -1,
    x0: 0,
    y0: 0,
    dx0: 0,
    lastX: 0,
    lastT: 0,
    vx: 0,
    width: 0,
    full: false,
    dragged: false,
    swallowUntil: 0,
    settleTimer: 0,
    detach: null as null | (() => void),
  });

  const revealW = () => live.current.actions.length * (PILL + GAP) + GAP;

  const ctl = useRef<{
    apply: (dx: number, animate: boolean) => void;
    open: () => void;
    close: (animated?: boolean) => void;
  } | null>(null);

  if (!ctl.current) {
    const st = s.current;
    const apply = (dx: number, animate: boolean) => {
      const el = wrapRef.current;
      st.dx = dx;
      if (!el) return;
      el.classList.toggle('is-animating', animate);
      el.style.setProperty('--dx', String(dx));
      el.style.setProperty('--p', String(Math.max(0, -dx)));
      if (dx < 0) el.classList.add('is-active');
      if (st.settleTimer) window.clearTimeout(st.settleTimer);
      st.settleTimer = 0;
      if (dx === 0) {
        const done = () => {
          st.settleTimer = 0;
          if (st.dx === 0) {
            el.classList.remove('is-active', 'is-animating', 'is-full');
          }
        };
        if (animate) st.settleTimer = window.setTimeout(done, 380);
        else done();
      }
    };
    const detachOutside = () => {
      st.detach?.();
      st.detach = null;
    };
    const close = (animated = true) => {
      st.open = false;
      st.full = false;
      wrapRef.current?.classList.remove('is-full');
      apply(0, animated);
      detachOutside();
      if (openRow === api) openRow = null;
    };
    const attachOutside = () => {
      if (st.detach) return;
      const onDown = (e: Event) => {
        const el = wrapRef.current;
        const t = e.target as Element | null;
        if (!el || !t) return;
        if (el.contains(t)) return; // handled by the row itself (drag / tap closes / action)
        // a tap on another list row only closes the open row (UITableView consumes it)
        if (t.closest?.('.ios-row, .ios-swipe')) st.swallowUntil = performance.now() + 700;
        close(true);
      };
      const onScroll = () => close(true);
      const onClick = (e: Event) => {
        if (performance.now() < st.swallowUntil) {
          st.swallowUntil = 0;
          e.stopPropagation();
          e.preventDefault();
        }
      };
      document.addEventListener('pointerdown', onDown, true);
      document.addEventListener('scroll', onScroll, true);
      document.addEventListener('click', onClick, true);
      st.detach = () => {
        document.removeEventListener('pointerdown', onDown, true);
        document.removeEventListener('scroll', onScroll, true);
        // keep the click swallower until the pending click has passed
        window.setTimeout(() => document.removeEventListener('click', onClick, true), 750);
      };
    };
    const open = () => {
      if (openRow && openRow !== api) openRow.close(true);
      openRow = api;
      st.open = true;
      apply(-revealW(), true);
      attachOutside();
    };
    const api = { apply, open, close };
    ctl.current = api;
  }

  useEffect(() => {
    const st = s.current;
    const api = ctl.current!;
    return () => {
      st.detach?.();
      st.detach = null;
      if (st.settleTimer) window.clearTimeout(st.settleTimer);
      if (openRow === api) openRow = null;
      releaseGesture(st);
    };
  }, []);

  useEffect(() => {
    if (disabled && s.current.open) ctl.current!.close(false);
  }, [disabled]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const st = s.current;
    // A touch pan never ends in a click, so a flag left by the previous drag would swallow this press's tap
    // (e.g. the tap that should close the open row, or open a row that was swiped and sprang back).
    st.dragged = false;
    const { actions: acts, disabled: dis } = live.current;
    if (dis || acts.length === 0) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!e.isPrimary) return;
    if ((e.target as Element).closest?.('.ios-swipe-actions')) return;
    if (!st.open && e.clientX <= EDGE_IGNORE) return; // edge-swipe-back territory
    st.track = 'pending';
    st.id = e.pointerId;
    st.x0 = st.lastX = e.clientX;
    st.y0 = e.clientY;
    st.dx0 = st.dx;
    st.lastT = e.timeStamp;
    st.vx = 0;
    st.dragged = false;
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const st = s.current;
    if (e.pointerId !== st.id || (st.track !== 'pending' && st.track !== 'h')) return;
    const mx = e.clientX - st.x0;
    const my = e.clientY - st.y0;
    const el = wrapRef.current!;
    if (st.track === 'pending') {
      if (Math.abs(mx) < LOCK && Math.abs(my) < LOCK) return;
      if (Math.abs(my) >= Math.abs(mx) || (st.dx0 === 0 && mx > 0)) {
        st.track = 'off';
        return;
      }
      st.track = 'h';
      // The lock above only accepts a clearly horizontal start, so it wins over a vertical recogniser
      // (pull-to-refresh, sheet drag) that claimed on an early jitter: that one ends cancelled and
      // springs back on its next move instead of moving together with the row.
      claimGesture(st);
      st.dragged = true;
      st.width = el.offsetWidth;
      const h = el.offsetHeight;
      el.classList.toggle('is-tall', h >= TALL_ROW);
      el.style.setProperty('--pill-h', h >= TALL_ROW ? `${Math.round(h - 16)}px` : '44px');
      el.classList.add('is-active');
      el.querySelectorAll('.is-pressed').forEach((n) => n.classList.remove('is-pressed'));
      if (openRow && openRow !== ctl.current) openRow.close(true);
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
    }
    // horizontal tracking
    const dt = Math.max(1, e.timeStamp - st.lastT);
    st.vx = 0.8 * ((e.clientX - st.lastX) / dt) + 0.2 * st.vx;
    st.lastX = e.clientX;
    st.lastT = e.timeStamp;

    const raw = st.dx0 + mx;
    const rw = revealW();
    let dx: number;
    if (raw >= 0) dx = raw * 0.15; // tiny resistance when pulled past closed
    else if (-raw <= rw) dx = raw;
    else if (live.current.fullSwipe) dx = raw; // follows the finger towards a full swipe
    else dx = -(rw + (-raw - rw) * 0.3); // rubber band
    if (dx > 0) dx = Math.min(dx, 12);

    const full = live.current.fullSwipe && -dx > st.width * FULL_RATIO;
    if (full !== st.full) {
      st.full = full;
      el.classList.toggle('is-full', full);
      haptic('light');
    }
    ctl.current!.apply(dx, false);
  };

  const finish = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const st = s.current;
    if (e.pointerId !== st.id) return;
    const wasH = st.track === 'h';
    st.track = 'idle';
    st.id = -1;
    releaseGesture(st);
    if (!wasH) return;
    const api = ctl.current!;
    if (!cancelled && st.full) {
      const first = live.current.actions[0];
      api.apply(-st.width, true);
      if (openRow && openRow !== api) openRow.close(true);
      window.setTimeout(() => {
        first?.onPress();
        api.close(true);
      }, 180);
      return;
    }
    const projected = st.dx + st.vx * 120;
    if (!cancelled && -projected > revealW() / 2) api.open();
    else api.close(true);
  };

  const onClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    const st = s.current;
    const inActions = (e.target as Element).closest?.('.ios-swipe-actions');
    if (st.dragged) {
      st.dragged = false;
      if (!inActions) {
        e.stopPropagation();
        e.preventDefault();
        return;
      }
    }
    // tapping the open row's content just closes it
    if (st.open && !inActions) {
      e.stopPropagation();
      e.preventDefault();
      ctl.current!.close(true);
    }
  };

  const acts = actions;
  return (
    <div
      ref={wrapRef}
      className="ios-swipe"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, false)}
      onPointerCancel={(e) => finish(e, true)}
      onClickCapture={onClickCapture}
    >
      <div className="ios-swipe-actions" aria-hidden={!s.current.open}>
        {acts.map((a, i) => (
          <button
            key={`${a.icon}-${a.label}-${i}`}
            type="button"
            className="ios-swipe-btn"
            aria-label={a.label}
            tabIndex={-1}
            style={{ ['--tint' as string]: a.tint ?? 'var(--accent)', ['--edge' as string]: GAP + i * (PILL + GAP) } as CSSProperties}
            onClick={(e) => {
              e.stopPropagation();
              a.onPress();
              ctl.current!.close(true);
            }}
          >
            {/* SwiftUI swipe actions render their Label symbols with the .fill variant */}
            <Icon name={fillVariant(a.icon)} size={21} strokeWidth={2} />
            <span className="ios-swipe-btn-label">{a.label}</span>
          </button>
        ))}
      </div>
      <div className="ios-swipe-content">{children}</div>
    </div>
  );
}
