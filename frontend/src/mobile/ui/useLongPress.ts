// Long press (SwiftUI `.onLongPressGesture(minimumDuration: 0.4)`)
// Pointer-event based (works on iOS Safari): fires after `ms` (default 400) unless the pointer moved more than
// `moveTolerance` (default 10px), lifted, was cancelled (the browser took over to scroll → pointercancel) or any
// scroll happened. After it fires, the click that follows the release is swallowed and any text selection that
// iOS started is cleared. The native callout / context menu is suppressed; a mouse right-click (desktop testing)
// triggers the long press immediately.
import { useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';

export interface LongPressHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  onContextMenu: (e: React.MouseEvent<HTMLElement>) => void;
}

/**
 * Long press (default 400ms, cancelled by >10px movement / scroll). Suppresses the native
 * callout/context menu. Callback receives the element the handlers are attached to.
 */
export function useLongPress(
  onLongPress: (el: HTMLElement) => void,
  opts?: { ms?: number; moveTolerance?: number; disabled?: boolean },
): LongPressHandlers {
  const cb = useRef(onLongPress);
  cb.current = onLongPress;
  const o = useRef(opts);
  o.current = opts;

  const st = useRef({
    timer: 0,
    id: -1,
    x: 0,
    y: 0,
    el: null as HTMLElement | null,
    firedAt: 0,
    unScroll: null as null | (() => void),
  });

  useEffect(() => {
    const s = st.current;
    return () => {
      if (s.timer) window.clearTimeout(s.timer);
      s.unScroll?.();
    };
  }, []);

  return useMemo<LongPressHandlers>(() => {
    const s = st.current;
    const cancel = () => {
      if (s.timer) window.clearTimeout(s.timer);
      s.timer = 0;
      s.id = -1;
      s.unScroll?.();
      s.unScroll = null;
    };
    // Only the click synthesised from THIS press is swallowed: it targets the pressed element (touch / same-element
    // mouse up) or a common ancestor (mouse released over an overlay that appeared meanwhile). A quick tap on a menu
    // item / backdrop presented by the long press (a portal, unrelated to the element) must go through.
    const swallowNextClick = (el: HTMLElement | null) => {
      const handler = (ev: Event) => {
        const t = ev.target as Node | null;
        window.removeEventListener('click', handler, true);
        if (!el || !t || !(el.contains(t) || t.contains(el))) return;
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener('click', handler, true);
      window.setTimeout(() => window.removeEventListener('click', handler, true), 400);
    };
    const fire = (el: HTMLElement) => {
      s.firedAt = performance.now();
      try {
        window.getSelection()?.removeAllRanges();
      } catch {
        /* noop */
      }
      cb.current(el);
    };
    return {
      onPointerDown(e) {
        if (o.current?.disabled) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (!e.isPrimary) return;
        cancel();
        s.id = e.pointerId;
        s.x = e.clientX;
        s.y = e.clientY;
        s.el = e.currentTarget;
        s.firedAt = 0;
        const onScroll = () => cancel();
        document.addEventListener('scroll', onScroll, true);
        s.unScroll = () => document.removeEventListener('scroll', onScroll, true);
        s.timer = window.setTimeout(() => {
          s.timer = 0;
          s.unScroll?.();
          s.unScroll = null;
          if (s.el && s.id !== -1) fire(s.el);
        }, o.current?.ms ?? 400);
      },
      onPointerMove(e) {
        if (e.pointerId !== s.id || !s.timer) return;
        const tol = o.current?.moveTolerance ?? 10;
        if (Math.abs(e.clientX - s.x) > tol || Math.abs(e.clientY - s.y) > tol) cancel();
      },
      onPointerUp(e) {
        if (e.pointerId !== s.id && s.id !== -1) return;
        const fired = s.firedAt > 0 && performance.now() - s.firedAt < 5000;
        cancel();
        if (fired) {
          s.firedAt = 0;
          swallowNextClick(s.el);
        }
      },
      onPointerCancel(e) {
        if (e.pointerId === s.id) cancel();
      },
      onContextMenu(e) {
        // Android long-press / desktop right-click: never show the native menu
        e.preventDefault();
        if (o.current?.disabled) return;
        const justFired = s.firedAt > 0 && performance.now() - s.firedAt < 1000;
        if (!justFired && s.id === -1 && !s.timer) {
          // desktop right-click (no pending touch long-press)
          fire(e.currentTarget);
          s.firedAt = 0;
        }
      },
    };
  }, []);
}
