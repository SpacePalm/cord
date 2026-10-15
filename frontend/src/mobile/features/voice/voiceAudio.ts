// Shared AudioContext for remote voice playback (LiveKit `webAudioMix`).
// iOS Safari only lets an AudioContext start inside a user gesture, but the LiveKit room is created
// after an async token fetch. So every entry point (voice row tap, call button, Accept, room/bar
// taps) calls primeVoiceAudio() synchronously in its handler; the room then plays through this
// already-running context, and per-user gains (0–300 %) are real Web Audio GainNodes.

let ctx: AudioContext | null = null;

type AudioCtor = typeof AudioContext;

export function primeVoiceAudio(): AudioContext | null {
  try {
    if (!ctx || ctx.state === 'closed') {
      const C: AudioCtor | undefined =
        (window as unknown as { AudioContext?: AudioCtor }).AudioContext ??
        (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
      if (!C) return null;
      ctx = new C({ latencyHint: 'interactive' });
    }
    if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
    return ctx;
  } catch {
    return null;
  }
}

export function voiceAudioContext(): AudioContext | null {
  return ctx && ctx.state !== 'closed' ? ctx : null;
}

/** Release the audio hardware between calls (resumed again by the next primeVoiceAudio()). */
export function suspendVoiceAudio(): void {
  // not gated on state === 'running': right after primeVoiceAudio() the context still reports 'suspended'
  // while its resume() is pending — a suspend() queued now runs after it (no-op when already suspended)
  if (ctx && ctx.state !== 'closed') void ctx.suspend().catch(() => undefined);
}

/** The context a user gesture has already started once (WebKit lifts its gesture restriction per context). */
let unlockedCtx: AudioContext | null = null;

/** True when the shared context exists and a tap has already started it (resume() works without a gesture). */
export function isVoiceAudioUnlocked(): boolean {
  return !!ctx && ctx === unlockedCtx && ctx.state !== 'closed';
}

/**
 * Unlock the shared context on the first tap anywhere in the mobile shell, so audio that starts later
 * WITHOUT a gesture (the incoming-call ringer) is allowed to play on iOS Safari. The context is started
 * inside the gesture and — when nothing is using it (`isIdle`) — suspended again right away: WebKit lifts the
 * restriction synchronously in resume(), and the queued suspend releases the audio hardware.
 * Returns the remover.
 */
export function installVoiceAudioUnlock(isIdle: () => boolean): () => void {
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  // touchend / click / pointerup / keydown carry user activation in WebKit and Blink (touchstart does not)
  const events = ['touchend', 'pointerup', 'click', 'keydown'] as const;
  const onGesture = () => {
    if (isVoiceAudioUnlocked()) return;
    const c = primeVoiceAudio();
    if (!c) return;
    unlockedCtx = c;
    if (isIdle()) suspendVoiceAudio();
  };
  events.forEach((ev) => window.addEventListener(ev, onGesture, opts));
  return () => events.forEach((ev) => window.removeEventListener(ev, onGesture, opts));
}

/** Can the browser route web-audio output to a chosen device (Chrome 110+)? */
export function supportsOutputSelection(): boolean {
  try {
    return typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;
  } catch {
    return false;
  }
}
