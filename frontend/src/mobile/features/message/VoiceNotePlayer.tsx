// iOS `VoiceNotePlayer` (Media/AudioVoice.swift): pill bg --bg-input radius --radius, padding 8×12, HStack(10):
// play.circle.fill / pause.circle.fill (.title, accent; failed → exclamationmark.triangle muted, disabled) ·
// 120px linear progress (not seekable) · m:ss caption2 tabular muted (duration when idle, current time while
// playing / paused mid-way) · mini spinner while loading after a tap.
// Web: the blob is fetched up-front (protected URL, shared cache) so the real duration is shown before the first
// play (accepted improvement, same look); playback starts on tap. No "one player at a time" coordination (iOS).
import './message.css';
import { useEffect, useRef, useState } from 'react';
import { Icon, Spinner } from '../../ui';
import { useMT } from '../../i18n';
import { useProtectedResource } from './media';

/** iOS `VoiceTime.format`: `Int(t.rounded())` → "m:ss" (minutes not padded). */
export function formatVoiceTime(t: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(t) ? t : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function VoiceNotePlayer({ url }: { url: string }) {
  const t = useMT();
  const res = useProtectedResource(url);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [wantPlay, setWantPlay] = useState(false);
  const [broken, setBroken] = useState(false);
  const raf = useRef(0);

  const failed = res.status === 'error' || broken;

  // audio element lifecycle (pause on unmount = iOS onDisappear)
  useEffect(() => {
    if (!res.src) return;
    const a = new Audio();
    a.preload = 'metadata';
    a.src = res.src;
    audioRef.current = a;
    const onMeta = () => {
      if (Number.isFinite(a.duration)) setDuration(a.duration);
      else {
        // WebM in some engines reports Infinity until it has been scanned to the end
        const fix = () => {
          if (Number.isFinite(a.duration)) {
            setDuration(a.duration);
            a.currentTime = 0;
            a.removeEventListener('timeupdate', fix);
          }
        };
        a.addEventListener('timeupdate', fix);
        a.currentTime = 1e10;
      }
    };
    const onDur = () => {
      if (Number.isFinite(a.duration)) setDuration(a.duration);
    };
    const onEnded = () => {
      // finished → back to the start
      setPlaying(false);
      setProgress(0);
      setCurrent(0);
      try {
        a.currentTime = 0;
      } catch {
        /* noop */
      }
    };
    const onPause = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    const onError = () => setBroken(true);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('durationchange', onDur);
    a.addEventListener('ended', onEnded);
    a.addEventListener('pause', onPause);
    a.addEventListener('play', onPlay);
    a.addEventListener('error', onError);
    return () => {
      a.pause();
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('durationchange', onDur);
      a.removeEventListener('ended', onEnded);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('play', onPlay);
      a.removeEventListener('error', onError);
      a.removeAttribute('src');
      try {
        a.load();
      } catch {
        /* noop */
      }
      audioRef.current = null;
    };
  }, [res.src]);

  // progress polling while playing (iOS polls every 50ms)
  useEffect(() => {
    if (!playing) return;
    const tick = () => {
      const a = audioRef.current;
      if (a) {
        const d = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : duration;
        setCurrent(a.currentTime);
        setProgress(d > 0 ? Math.min(1, a.currentTime / d) : 0);
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, duration]);

  // a tap that arrived while the file was still loading → play as soon as it is ready (iOS load → play)
  useEffect(() => {
    if (!wantPlay || !audioRef.current) return;
    setWantPlay(false);
    audioRef.current.play().catch(() => {});
  }, [wantPlay, res.src]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (failed) return;
    const a = audioRef.current;
    if (!a) {
      setWantPlay(true);
      return;
    }
    if (!a.paused) a.pause();
    else a.play().catch(() => {});
  };

  const shown = playing || progress > 0 ? current : duration;
  const loading = wantPlay && !failed && !res.src;

  return (
    <div className="m-msg-voice">
      <button
        type="button"
        className="m-msg-voice-btn"
        onClick={toggle}
        disabled={failed || loading}
        aria-label={playing ? t('message.pause') : t('message.play')}
      >
        {failed ? (
          <Icon name="exclamationmark.triangle" size={30} strokeWidth={1.6} color="var(--text-muted)" />
        ) : (
          <Icon name={playing ? 'pause.circle.fill' : 'play.circle.fill'} size={34} color="var(--accent)" />
        )}
      </button>
      <span className="m-msg-voice-track" aria-hidden>
        <span className="m-msg-voice-fill" style={{ width: `${progress * 100}%` }} />
      </span>
      <span className="m-msg-voice-time">{formatVoiceTime(shown)}</span>
      {loading && <Spinner />}
    </div>
  );
}
