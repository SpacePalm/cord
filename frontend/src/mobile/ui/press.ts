// UIKit-like cell highlight for list rows.
// The highlight is applied directly to the DOM (class "is-pressed") so pressing never re-renders React.
// Touch: highlight after a short delay so that a row touched at the start of a scroll does not flash;
// a quick tap still flashes briefly. Movement > 8px, pointercancel (the browser took over to scroll)
// or a press that started on a nested control cancels it. Release fades out (CSS transition 300ms).
import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';

/** Nested controls inside a row: pressing them neither highlights nor activates the row. */
export const ROW_INTERACTIVE = 'button, a[href], input, select, textarea, label, [role="switch"], [role="button"]:not(.ios-row), [data-no-row-press]';
const INTERACTIVE = ROW_INTERACTIVE;
const TOUCH_DELAY = 70;
const TAP_FLASH = 110;
const MOVE_TOLERANCE = 8;

export interface PressHighlightHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave: (e: ReactPointerEvent<HTMLElement>) => void;
}

export function usePressHighlight(enabled: boolean): PressHighlightHandlers | undefined {
  const st = useRef<{ el: HTMLElement | null; x: number; y: number; timer: number; on: boolean; id: number }>({
    el: null,
    x: 0,
    y: 0,
    timer: 0,
    on: false,
    id: -1,
  });

  const handlers = useMemo<PressHighlightHandlers>(() => {
    const s = st.current;
    const set = (on: boolean) => {
      // a row that is being swiped (SwipeRow) never shows the press highlight
      if (on && s.el?.closest('.ios-swipe.is-active')) on = false;
      s.on = on;
      s.el?.classList.toggle('is-pressed', on);
    };
    const clear = () => {
      if (s.timer) window.clearTimeout(s.timer);
      s.timer = 0;
    };
    const cancel = () => {
      clear();
      set(false);
      s.id = -1;
    };
    return {
      onPointerDown(e) {
        if (e.button !== 0 || !e.isPrimary) return;
        const row = e.currentTarget;
        const t = e.target as Element | null;
        const inner = t?.closest?.(INTERACTIVE);
        if (inner && inner !== row && row.contains(inner)) return;
        clear();
        s.el = row;
        s.x = e.clientX;
        s.y = e.clientY;
        s.id = e.pointerId;
        if (e.pointerType === 'mouse') set(true);
        else s.timer = window.setTimeout(() => {
          s.timer = 0;
          set(true);
        }, TOUCH_DELAY);
      },
      onPointerMove(e) {
        if (e.pointerId !== s.id) return;
        if (Math.abs(e.clientX - s.x) > MOVE_TOLERANCE || Math.abs(e.clientY - s.y) > MOVE_TOLERANCE) cancel();
      },
      onPointerUp(e) {
        if (e.pointerId !== s.id) return;
        s.id = -1;
        if (s.timer) {
          // quick tap: flash the highlight, then fade it out
          clear();
          set(true);
          s.timer = window.setTimeout(() => {
            s.timer = 0;
            set(false);
          }, TAP_FLASH);
          return;
        }
        set(false);
      },
      onPointerCancel(e) {
        if (e.pointerId === s.id) cancel();
      },
      onPointerLeave(e) {
        if (e.pointerId === s.id && e.pointerType === 'mouse') cancel();
      },
    };
  }, []);

  return enabled ? handlers : undefined;
}
