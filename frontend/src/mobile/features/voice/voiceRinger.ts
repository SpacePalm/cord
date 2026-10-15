// Incoming-call ringer of the mobile shell.
// The shared desktop util (utils/ringtone.ts) creates a fresh AudioContext for every ring; iOS Safari keeps
// such a context suspended outside a user gesture, so the ring stayed silent. Here the ring plays through
// the voice feature's shared AudioContext (voiceAudio.ts), which an earlier tap has already unlocked
// (installVoiceAudioUnlock). Same tone pattern as the util: 440 Hz + 550 Hz, 0.4 s each, every 2 s.
// Graceful fallback to the util when there is no unlocked context or it refuses to start.
import { startRingtone, stopRingtone } from '../../../utils/ringtone';
import { isVoiceAudioUnlocked, voiceAudioContext } from './voiceAudio';

const CYCLE_MS = 2000;
/** Blink keeps resume() pending (instead of rejecting) without activation — don't wait for it forever. */
const RESUME_TIMEOUT_MS = 600;

type Ring = { stop: () => void };
let active: Ring | null = null;

export function isRingerActive(): boolean {
  return active !== null;
}

/** Start ringing (replaces a running ring). `volume` 0..1. */
export function startVoiceRinger(volume: number): void {
  stopVoiceRinger();
  const v = Math.max(0, Math.min(1, volume));
  if (v === 0) return;
  const ctx = isVoiceAudioUnlocked() ? voiceAudioContext() : null;
  active = ctx ? ringThrough(ctx, v) : fallbackRing(v);
}

export function stopVoiceRinger(): void {
  const r = active;
  active = null;
  r?.stop();
}

function fallbackRing(v: number): Ring {
  startRingtone(v);
  return { stop: stopRingtone };
}

function ringThrough(ctx: AudioContext, v: number): Ring {
  const peak = 0.55 * v;
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);
  const oscs = new Set<OscillatorNode>();
  let cancelled = false;
  let started = false;
  let timer = 0;
  let fallback: Ring | null = null;

  const tone = (when: number, freq: number, dur: number) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, when);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + 0.02);
    g.gain.linearRampToValueAtTime(peak, when + dur - 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(g);
    g.connect(master);
    osc.onended = () => {
      oscs.delete(osc);
      try {
        g.disconnect();
      } catch {
        /* ignore */
      }
    };
    osc.start(when);
    osc.stop(when + dur + 0.02);
    oscs.add(osc);
  };

  const cycle = () => {
    if (cancelled) return;
    // a suspended context freezes currentTime — don't pile up notes, just wait for the next cycle
    if (ctx.state === 'running') {
      const t = ctx.currentTime + 0.05;
      tone(t, 440, 0.4);
      tone(t + 0.5, 550, 0.4);
    }
    timer = window.setTimeout(cycle, CYCLE_MS);
  };

  const begin = () => {
    if (cancelled || started || fallback) return;
    if (ctx.state !== 'running') return giveUp();
    started = true;
    window.clearTimeout(timer);
    cycle();
  };

  const giveUp = () => {
    if (cancelled || started || fallback) return;
    window.clearTimeout(timer);
    try {
      master.disconnect();
    } catch {
      /* ignore */
    }
    fallback = fallbackRing(v);
  };

  // always resume: it also overrides a suspend still queued by an idle release (teardown / unlock tap)
  timer = window.setTimeout(giveUp, RESUME_TIMEOUT_MS);
  ctx.resume().then(begin, giveUp);

  return {
    stop: () => {
      if (cancelled) return;
      cancelled = true;
      window.clearTimeout(timer);
      if (fallback) {
        fallback.stop();
        return;
      }
      // no fade: the caller may suspend the shared context right after (idle) — cut cleanly
      try {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setValueAtTime(0, ctx.currentTime);
      } catch {
        /* ignore */
      }
      oscs.forEach((o) => {
        try {
          o.stop();
        } catch {
          /* already stopped */
        }
      });
      oscs.clear();
      try {
        master.disconnect();
      } catch {
        /* ignore */
      }
    },
  };
}
