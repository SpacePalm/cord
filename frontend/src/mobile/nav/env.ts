// Platform helpers for the mobile shell (nav + presentation).

/** iPhone / iPad (incl. iPadOS that reports itself as a Mac). */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return false;
  return /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Installed PWA (home-screen app): no browser chrome, no native back-swipe. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

/**
 * iOS browsers in a normal tab (Safari, Chrome iOS…) perform their own edge-swipe-back with a
 * snapshot animation. There we must not run our own gesture/animation.
 */
export function hasNativeBackSwipe(): boolean {
  return isIOS() && !isStandalone();
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** iOS UINavigationController / sheet curve. */
export const EASE_NAV = 'cubic-bezier(0.32, 0.72, 0, 1)';
/** SwiftUI spring(response 0.35, damping 0.85) approximation. */
export const EASE_SPRING = 'cubic-bezier(0.2, 0.9, 0.25, 1)';
export const DUR_PUSH = 500;
export const DUR_SHEET_IN = 500;
export const DUR_SHEET_OUT = 350;
