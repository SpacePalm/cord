// Voice-note recorder (iOS VoiceRecorder, Cord/Media/AudioVoice.swift) on MediaRecorder.
//  · start() must run inside the tap (iOS Safari permission prompt + user gesture)
//  · prefers audio/mp4 (Safari → m4a like iOS), else webm/opus; file `voice_<unixSeconds>.<m4a|webm>`
//  · elapsed ticks every 100ms; an OS interruption (track ended / recorder stopped) cancels silently
import { useCallback, useEffect, useRef, useState } from 'react';

const MIME_CANDIDATES = ['audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  for (const m of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* ignore */
    }
  }
  return '';
}

function extFor(mime: string): string {
  if (mime.includes('mp4') || mime.includes('aac') || mime.includes('m4a')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}

export interface VoiceRecorderApi {
  recording: boolean;
  /** Seconds since start. */
  elapsed: number;
  /** false → permission denied / recorder failed (caller shows the mic-denied alert). */
  start(): Promise<boolean>;
  /** Stop and return the voice file (null when nothing was recorded). */
  stop(): Promise<File | null>;
  cancel(): void;
}

export function useVoiceRecorder(): VoiceRecorderApi {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const ticker = useRef(0);
  const starting = useRef(false);
  const finishing = useRef<((f: File | null) => void) | null>(null);
  /** Bumped by cancel() / unmount: a getUserMedia that resolves afterwards releases its stream at once. */
  const gen = useRef(0);
  const mounted = useRef(true);

  const cleanup = useCallback(() => {
    window.clearInterval(ticker.current);
    ticker.current = 0;
    stream.current?.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        /* ignore */
      }
    });
    stream.current = null;
    rec.current = null;
    setRecording(false);
  }, []);

  const cancel = useCallback(() => {
    const r = rec.current;
    gen.current++;
    // a stop() in flight resolves with nothing (its onstop is detached below)
    const pendingStop = finishing.current;
    finishing.current = null;
    pendingStop?.(null);
    if (r) {
      r.ondataavailable = null;
      r.onstop = null;
      try {
        if (r.state !== 'inactive') r.stop();
      } catch {
        /* ignore */
      }
    }
    chunks.current = [];
    cleanup();
  }, [cleanup]);

  const start = useCallback(async (): Promise<boolean> => {
    if (rec.current || starting.current) return true;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return false;
    starting.current = true;
    const myGen = gen.current;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || myGen !== gen.current) {
        // unmounted / cancelled (screen covered, app hidden) while the permission prompt was up:
        // release the microphone right away instead of recording on a dead composer
        s.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {
            /* ignore */
          }
        });
        return true;
      }
      const mime = pickMime();
      let r: MediaRecorder;
      try {
        r = mime ? new MediaRecorder(s, { mimeType: mime }) : new MediaRecorder(s);
      } catch {
        s.getTracks().forEach((t) => t.stop());
        return false;
      }
      stream.current = s;
      rec.current = r;
      chunks.current = [];
      r.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.current.push(e.data);
      };
      r.onstop = () => {
        const done = finishing.current;
        finishing.current = null;
        const type = (r.mimeType || mime || 'audio/webm').split(';')[0];
        const blob = new Blob(chunks.current, { type });
        chunks.current = [];
        cleanup();
        if (!done) return; // stopped by the system → treated as cancel (iOS: bar disappears, nothing sent)
        if (!blob.size) {
          done(null);
          return;
        }
        const ext = extFor(type);
        const fileType = ext === 'm4a' ? 'audio/mp4' : type;
        done(new File([blob], `voice_${Math.floor(Date.now() / 1000)}.${ext}`, { type: fileType }));
      };
      s.getAudioTracks().forEach((t) => {
        t.onended = () => {
          if (rec.current === r && !finishing.current) cancel();
        };
      });
      r.start(250);
      startedAt.current = performance.now();
      setElapsed(0);
      setRecording(true);
      ticker.current = window.setInterval(() => {
        if (rec.current !== r) return;
        if (r.state !== 'recording') {
          if (!finishing.current) cancel();
          return;
        }
        setElapsed((performance.now() - startedAt.current) / 1000);
      }, 100);
      return true;
    } catch {
      return false;
    } finally {
      starting.current = false;
    }
  }, [cancel, cleanup]);

  const stop = useCallback((): Promise<File | null> => {
    // a second tap on send while the first stop is finishing: nothing more to send (and never cancel()
    // here — that would detach onstop and lose the note the first tap is waiting for)
    if (finishing.current) return Promise.resolve(null);
    const r = rec.current;
    if (!r || r.state === 'inactive') {
      cancel();
      return Promise.resolve(null);
    }
    return new Promise<File | null>((resolve) => {
      finishing.current = resolve;
      try {
        r.requestData?.();
      } catch {
        /* ignore */
      }
      try {
        r.stop();
      } catch {
        finishing.current = null;
        cancel();
        resolve(null);
      }
    });
  }, [cancel]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancel();
    };
  }, [cancel]);

  return { recording, elapsed, start, stop, cancel };
}

/** iOS VoiceTime.format: m:ss with seconds rounded. */
export function formatVoiceTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
