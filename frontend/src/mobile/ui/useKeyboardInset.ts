import { useEffect, useState } from 'react';

/** Current on-screen keyboard overlap in px (iOS Safari keeps the layout viewport; the visual viewport shrinks). */
export function keyboardInsetNow(): number {
  if (typeof window === 'undefined') return 0;
  const vv = window.visualViewport;
  if (!vv) return 0;
  const inset = window.innerHeight - vv.height - vv.offsetTop;
  // ignore toolbar / rounding noise (the keyboard is always far taller than this)
  return inset > 40 ? Math.round(inset) : 0;
}

/**
 * Pixels of the layout viewport covered by the on-screen keyboard (iOS Safari does not
 * resize the layout viewport). Bottom bars add this to stay on top of the keyboard.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(keyboardInsetNow);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setInset(keyboardInsetNow()));
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    window.addEventListener('focusin', update);
    window.addEventListener('focusout', update);
    update();
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      window.removeEventListener('focusin', update);
      window.removeEventListener('focusout', update);
    };
  }, []);
  return inset;
}
