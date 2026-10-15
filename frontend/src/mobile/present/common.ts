// Small helpers shared by the presentation layer views.
import { useEffect, useLayoutEffect, type RefObject } from 'react';

/** Toggle the `inert` attribute (React 18 has no typed prop for it). */
export function useInert(ref: RefObject<HTMLElement | null>, inert: boolean): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.toggleAttribute('inert', inert);
  }, [ref, inert]);
}

/**
 * Move focus into a freshly presented modal layer (unless its content focused something itself or
 * the keyboard was primed for a text field that is about to mount).
 */
export function useInitialFocus(ref: RefObject<HTMLElement | null>, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const t = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const ae = document.activeElement as HTMLElement | null;
      if (ae && el.contains(ae)) return;
      if (ae && ae.classList.contains('ios-focus-proxy')) {
        // primed keyboard but nobody took focus → release it
        window.setTimeout(() => {
          if (document.activeElement === ae) ae.blur();
        }, 600);
        return;
      }
      try {
        el.focus({ preventScroll: true });
      } catch {
        /* ignore */
      }
    }, 30);
    return () => window.clearTimeout(t);
  }, [ref, enabled]);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** Visible viewport height above the on-screen keyboard (layout px). */
export function viewportHeight(kbInset: number): number {
  return Math.max(0, window.innerHeight - kbInset);
}

let probe: HTMLDivElement | null = null;
/** env(safe-area-inset-top) in px. */
export function safeAreaTop(): number {
  if (typeof document === 'undefined') return 0;
  if (!probe) {
    probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px)';
    document.body.appendChild(probe);
  }
  return parseFloat(getComputedStyle(probe).paddingTop) || 0;
}
