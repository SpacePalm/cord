/**
 * UIImpactFeedbackGenerator analogue: 'medium' on message long-press and swipe-to-reply,
 * 'light' on code-block copy. Vibrates on Android (10 / 5 ms); a no-op on iOS Safari (no Vibration API).
 */
export function haptic(style: 'light' | 'medium' | 'heavy' | 'selection'): void {
  try {
    const ms = style === 'heavy' ? 15 : style === 'medium' ? 10 : style === 'selection' ? 3 : 5;
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(ms);
  } catch {
    /* noop */
  }
}
