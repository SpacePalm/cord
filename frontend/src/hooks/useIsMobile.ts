import { useSyncExternalStore } from 'react';

// Single source of truth for the mobile breakpoint (< 768px). The mobile web UI is a
// separate iOS-style shell (src/mobile); desktop layout is untouched above this width.
const MQ = '(max-width: 767.98px)';

function subscribe(cb: () => void) {
  const m = window.matchMedia(MQ);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
}

export function isMobileNow(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(MQ).matches;
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, isMobileNow, () => false);
}
