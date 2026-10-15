// iOS ScrollView default `.scrollDismissesKeyboard(.automatic)`: a drag on the form dismisses the
// keyboard. Touch-driven (not `scroll`), so Safari's own focus-scrolling never blurs.
import { useEffect, type RefObject } from 'react';

function isTextInput(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}

export function useBlurOnDrag(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let sx = 0;
    let sy = 0;
    let armed = false;
    const blur = () => {
      const ae = document.activeElement;
      if (isTextInput(ae) && el.contains(ae)) ae.blur();
    };
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      sx = t.clientX;
      sy = t.clientY;
      armed = true;
    };
    const onMove = (e: TouchEvent) => {
      if (!armed) return;
      const t = e.touches[0];
      if (!t) return;
      if (Math.abs(t.clientY - sy) > 10 || Math.abs(t.clientX - sx) > 10) {
        armed = false;
        blur();
      }
    };
    const onEnd = () => {
      armed = false;
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    el.addEventListener('wheel', blur, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      el.removeEventListener('wheel', blur);
    };
  }, [ref]);
}
